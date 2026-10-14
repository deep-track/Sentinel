const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Transpiles a TS module (and its relative imports) to CommonJS.
function loadTs(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  });
  const module = { exports: {} };
  cache.set(relative, module.exports);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = path.resolve(path.dirname(path.join(root, relative)), specifier);
    return loadTs(path.relative(root, resolved.endsWith(".ts") ? resolved : `${resolved}.ts`), cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const store = loadTs("backend/convex/lib/amlMonitoringStore.ts");
const openSanctions = loadTs("backend/convex/lib/openSanctions.ts");
const webhooks = loadTs("backend/convex/lib/webhookDispatch.ts");

const hit = (key, overrides = {}) => ({
  key,
  source: "OPENSANCTIONS",
  sourceRecordId: key,
  entityName: key,
  categories: ["pep"],
  riskLevel: "high",
  ...overrides,
});

// ── Baseline comparison ─────────────────────────────────────────────────────

test("monitoring alerts on new hits and on hits that became more severe, never on removals", () => {
  const baseline = [hit("a", { pepClass: 3 }), hit("b"), hit("c")];
  const current = [
    hit("a", { pepClass: 1 }), // more senior PEP class
    hit("b", { categories: ["pep", "sanctions"] }), // gained a category
    hit("d"), // new
  ];
  const { added, escalated, removed } = store.diffHits(baseline, current);
  assert.deepEqual(added.map((h) => h.key), ["d"]);
  assert.deepEqual(escalated.map((h) => h.key), ["a", "b"]);
  assert.deepEqual(removed.map((h) => h.key), ["c"]);

  const unchanged = store.diffHits([hit("a", { pepClass: 2 })], [hit("a", { pepClass: 2 })]);
  assert.equal(unchanged.added.length + unchanged.escalated.length, 0);
  const milder = store.diffHits([hit("a", { pepClass: 1 })], [hit("a", { pepClass: 3 })]);
  assert.equal(milder.escalated.length, 0, "a less senior class is not an alert");
  const critical = store.diffHits([hit("a")], [hit("a", { riskLevel: "critical" })]);
  assert.equal(critical.escalated.length, 1);
});

test("hits are keyed by source and record id, de-duplicated and capped", () => {
  const matches = [
    { source: "OFAC_SDN", sourceRecordId: "1", entityName: "X", riskLevel: "critical" },
    { source: "OFAC_SDN", sourceRecordId: "1", entityName: "X", riskLevel: "critical" },
    { source: "OPENSANCTIONS", sourceRecordId: "1", entityName: "X", riskLevel: "high", categories: ["pep"], pepClass: 2 },
  ];
  const hits = store.hitsFromMatches(matches);
  assert.deepEqual(hits.map((h) => h.key), ["OFAC_SDN:1", "OPENSANCTIONS:1"]);
  assert.equal(hits[1].pepClass, 2);
  assert.deepEqual(hits[0].categories, []);
  const many = Array.from({ length: 80 }, (_, i) => ({ source: "OPENSANCTIONS", sourceRecordId: String(i), entityName: "n", riskLevel: "high" }));
  assert.equal(store.hitsFromMatches(many).length, store.MAX_STORED_HITS);
  assert.match(store.buildMonitoringReference(), /^mon_[0-9a-f]{32}$/);
});

// ── PEP positions ───────────────────────────────────────────────────────────

function occupancy({ title, topics, status, startDate, endDate, country = "ke" }) {
  return {
    schema: "Occupancy",
    properties: {
      post: [{ schema: "Position", properties: { name: [title], topics, country: [country] } }],
      ...(status ? { status: [status] } : {}),
      ...(startDate ? { startDate: [startDate] } : {}),
      ...(endDate ? { endDate: [endDate] } : {}),
    },
  };
}
const entity = (...occupancies) => ({ id: "Q1", schema: "Person", properties: { positionOccupancies: occupancies } });
const NOW = Date.parse("2026-10-13T00:00:00Z");

test("PEP class and status come from the positions actually held", () => {
  const president = occupancy({ title: "President of Kenya", topics: ["gov.national", "gov.head"], status: "current", startDate: "2022-09-13" });
  const governor = occupancy({ title: "Governor of Nairobi County", topics: ["gov.state"], status: "current" });
  const formerMp = occupancy({ title: "Member of the National Assembly", topics: ["gov.national", "gov.legislative"], status: "ended", endDate: "2013-03-04" });
  const parse = (...occ) => openSanctions.parsePepPositions(entity(...occ), NOW);

  assert.deepEqual(openSanctions.classifyPositions(parse(president)), { pepClass: 1, pepStatus: "current" });
  assert.deepEqual(openSanctions.classifyPositions(parse(governor)), { pepClass: 2, pepStatus: "current" });
  // A current county role decides the class over a former national one.
  assert.deepEqual(openSanctions.classifyPositions(parse(governor, formerMp)), { pepClass: 2, pepStatus: "current" });
  assert.deepEqual(openSanctions.classifyPositions(parse(formerMp)), { pepClass: 1, pepStatus: "former" });
  // An end date in the past means ended, even without a status.
  const ended = parse(occupancy({ title: "Cabinet Secretary", topics: ["gov.national"], endDate: "2020-01-01" }));
  assert.equal(ended[0].current, false);
  // No status and no end date is read as still held.
  assert.equal(parse(occupancy({ title: "Senator", topics: ["gov.national"] }))[0].current, true);
  assert.deepEqual(openSanctions.classifyPositions([]), { pepClass: null, pepStatus: "unknown" });
  // Positions without a level don't override the topic-based class.
  assert.equal(openSanctions.classifyPositions(parse(occupancy({ title: "Adviser", topics: [] }))).pepClass, null);
});

test("a position-based class replaces the topic default, except for close associates", () => {
  const base = openSanctions.parseMatchResponse({
    responses: { q: { status: 200, results: [{ id: "Q1", caption: "X", schema: "Person", score: 0.95, match: true, datasets: [], properties: { topics: ["role.pep"] } }] } },
  })[0];
  assert.equal(openSanctions.pepClass(base), 1, "unlevelled PEP defaults to Class 1");
  const governor = openSanctions.applyPepPositions(base, openSanctions.parsePepPositions(entity(occupancy({ title: "Governor", topics: ["gov.state"], status: "current" })), NOW));
  assert.equal(openSanctions.pepClass(governor), 2);
  assert.equal(governor.pepStatus, "current");
  assert.equal(governor.pepPositions[0].title, "Governor");
  assert.match(openSanctions.decideOpenSanctions([governor]).reason, /PEP Class 2/);

  const former = openSanctions.applyPepPositions(base, openSanctions.parsePepPositions(entity(occupancy({ title: "Minister", topics: ["gov.national"], status: "ended" })), NOW));
  assert.match(openSanctions.decideOpenSanctions([former]).reason, /former politically exposed person match \(PEP Class 1/);

  const rca = { ...base, topics: ["role.rca"], positionPepClass: 1 };
  assert.equal(openSanctions.pepClass(rca), 4);
});

// ── OpenSanctions requests ──────────────────────────────────────────────────

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("batch match: one request, one query per subject, failures isolated per subject", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, {
      responses: {
        s0: { status: 200, results: [{ id: "a", caption: "A", schema: "Person", score: 0.9, match: true, datasets: [], properties: { topics: ["sanction"] } }] },
        s1: { status: 500 },
      },
    });
  };
  const results = await openSanctions.matchOpenSanctionsMany(
    [
      { name: "Jane Doe", entityType: "individual", birthDate: "1970" },
      { name: "Acme Ltd", entityType: "entity", registrationNumber: "PVT-1" },
    ],
    { apiKey: "k", fetchImpl },
  );
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(body.queries), ["s0", "s1"]);
  assert.equal(body.queries.s0.schema, "Person");
  assert.deepEqual(body.queries.s0.properties.birthDate, ["1970"]);
  assert.equal(body.queries.s1.schema, "LegalEntity");
  assert.equal(captured.init.headers.Authorization, "ApiKey k");
  assert.equal(results[0][0].id, "a");
  assert.ok(results[1] instanceof openSanctions.OpenSanctionsRequestError);
  assert.deepEqual(await openSanctions.matchOpenSanctionsMany([], { apiKey: "k", fetchImpl }), []);
});

test("entity lookup is a nested GET with the ApiKey header and no body", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, entity());
  };
  await openSanctions.fetchEntityNested("NK-a/b", { apiKey: "k", fetchImpl });
  assert.equal(captured.url, "https://api.opensanctions.org/entities/NK-a%2Fb?nested=true");
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.body, undefined);
  assert.equal(captured.init.headers["Content-Type"], undefined);
  assert.equal(captured.init.headers.Authorization, "ApiKey k");
});

// ── Webhooks ────────────────────────────────────────────────────────────────

test("monitoring alerts use their own webhook event", () => {
  const alert = webhooks.buildWebhookPayload({ reference: "ver_1", verdict: "review", result: { monitoring: { reference: "mon_1" } } });
  assert.equal(alert.event, "sentinel.monitoring.alert");
  assert.equal(alert.status, "REVIEW");
  assert.equal(webhooks.buildWebhookPayload({ reference: "ver_2", verdict: "pass", result: {} }).event, "sentinel.scan.complete");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("monitoring wiring: enrolment, schedule, baseline, alerts and API", () => {
  const aml = read("backend/convex/aml.ts");
  // Without an explicit monitor flag the client's default (Settings) decides.
  assert.match(aml, /const monitor = args\.monitor \?\? settings\.screening\.monitoringDefault;/);
  assert.match(aml, /const monitoring = monitor\s*\? await enrolMonitoredSubject\(ctx,/);
  assert.match(aml, /intervalMs: monitoringIntervalMs\(settings\.screening\.monitoringFrequency\)/);
  assert.match(aml, /A customer reference is only used with monitor: true\./);
  assert.match(aml, /\/\/ Test-mode keys never enrol subjects for monitoring\./);
  assert.match(aml, /export async function screenSubjects\(ctx: ActionCtx, subjects: ScreeningSubject\[\], rules\?: ScreeningRules\[\]\)/);

  const monitoring = read("backend/convex/amlMonitoring.ts");
  assert.match(monitoring, /if \(!outcome\.complete\) \{\s*\/\/ A list or OpenSanctions was unavailable: keep the baseline, retry soon\./);
  assert.match(monitoring, /diffHits\(subject\.baselineSet \? subject\.hits : \[\], current\)/);
  assert.match(monitoring, /chargeCredits: false,/, "re-screens are not charged");
  assert.match(monitoring, /verdict: outcome\.verdict === "pass" \? "review" : outcome\.verdict/);
  assert.match(monitoring, /action: "aml\.monitoring_hits_removed"/);
  assert.match(monitoring, /action: "aml\.monitoring_removed"/);
  assert.match(monitoring, /await requireClientRole\(ctx, subject\.clientId, \[\.\.\.WRITE_ROLES\]\)/);

  const persistence = read("backend/convex/amlPersistence.ts");
  assert.match(persistence, /action: args\.monitoring \? "aml\.monitoring_alert" : "aml\.screened"/);
  assert.match(
    persistence,
    /if \(!args\.monitoring && \(args\.complete \?\? args\.chargeCredits \?\? true\)\) \{\s*const \{ screening \} = await loadClientSettings\(ctx, args\.clientId\);\s*await setBaselineFromEnrolment\(ctx, args\.verificationId, args\.matches, monitoringIntervalMs\(screening\.monitoringFrequency\)\)/,
  );
  // Re-screens follow each client's rules and frequency.
  assert.match(monitoring, /internalApi\.aml\._screeningRules, \{ clientIds: due\.map\(\(subject\) => subject\.clientId\) \}/);
  assert.match(monitoring, /nextScreenAt: now \+ monitoringIntervalMs\(screening\.monitoringFrequency\)/);

  assert.match(read("backend/convex/crons.ts"), /crons\.interval\("re-screen monitored AML subjects", \{ minutes: 15 \}, internal\.amlMonitoring\.runDue/);
  assert.equal(store.RESCREEN_INTERVAL_MS, 24 * 60 * 60 * 1000);

  const http = read("backend/convex/http.ts");
  assert.match(http, /path: "\/v1\/monitoring\/subjects",\s*method: "GET"/);
  assert.match(http, /pathPrefix: "\/v1\/monitoring\/subjects\/",\s*method: "DELETE"/);
  assert.match(http, /\/\^mon_\[A-Za-z0-9\]\{1,64\}\$\//);
  assert.match(read("backend/convex/schema.ts"), /\.index\("by_status_and_next_screen", \["status", "nextScreenAt"\]\)/);
});
