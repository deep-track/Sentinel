const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

// Minimal TS loader: transpiles each module to CommonJS and resolves relative
// imports to sibling .ts files. Only used for pure lib/ modules that don't
// import Convex generated code.
function loadTs(relative, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const base = path.resolve(path.dirname(file), specifier);
    const resolved = [`${base}.ts`, path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${relative}`);
    return loadTs(path.relative(root, resolved), cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const riskEngine = loadTs("backend/convex/lib/riskEngine.ts");
const matching = loadTs("backend/convex/lib/amlMatching.ts");
const parsers = loadTs("backend/convex/lib/watchlistParsers.ts");

// ── Risk engine ────────────────────────────────────────────────────────────

const HEALTHY = {
  "/internal/liveness": { liveness_score: 0.97, deepfake_flag: false, confidence: 0.9 },
  "/internal/doc-scan": { fake_score: 0.05, flags: [], document_type: "national_id" },
  "/internal/iprs/query": { status: "MATCH" },
  "/internal/aml/query": { status: "CLEAR", matches: [] },
};

const INPUT = {
  liveness: { frames: "ZnJhbWVz", mediaType: "jpeg_frames" },
  document: { frontImageBase64: "ZnJvbnQ=" },
  identity: { idNumber: "12345678", firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-01-01", gender: "F" },
  amlEntityName: "Jane Doe",
};

function jsonResponse(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

// Runs the orchestration with per-path overrides. An override is either a
// JSON body or a function returning a Response.
async function orchestrate(t, overrides = {}, input = INPUT) {
  const calls = [];
  process.env.SENTINEL_INTERNAL_API_BASE_URL = "https://internal.example.test";
  process.env.SENTINEL_INTERNAL_API_TOKEN = "test-token";
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    const override = overrides[pathname];
    if (typeof override === "function") return override();
    return jsonResponse(200, override ?? HEALTHY[pathname]);
  });
  const result = await riskEngine.orchestrateIdpVerification(input);
  return { result, calls };
}

test("risk engine passes only when every check is explicitly clear", async (t) => {
  const { result } = await orchestrate(t);
  assert.equal(result.verdict, "pass");
});

test("risk engine: absent liveness is never a pass", async (t) => {
  const { result, calls } = await orchestrate(t, {}, { ...INPUT, liveness: undefined });
  assert.equal(result.verdict, "review");
  assert.match(result.reason, /liveness was not collected/i);
  assert.equal(result.stepResults.liveness, undefined);
  assert.ok(!calls.includes("/internal/liveness"));
  // Remaining checks still run, so hard rejects are not masked.
  assert.ok(calls.includes("/internal/aml/query"));
});

test("risk engine: absent liveness still rejects on a sanctions hit", async (t) => {
  const { result } = await orchestrate(
    t,
    { "/internal/aml/query": { status: "SANCTIONS_HIT", matches: [] } },
    { ...INPUT, liveness: undefined },
  );
  assert.equal(result.verdict, "reject");
});

test("risk engine: unknown IPRS status goes to review", async (t) => {
  const { result } = await orchestrate(t, { "/internal/iprs/query": { status: "DECEASED" } });
  assert.equal(result.verdict, "review");
  assert.match(result.reason, /unrecognised/i);
});

test("risk engine: IPRS status is case-normalised", async (t) => {
  const { result } = await orchestrate(t, { "/internal/iprs/query": { status: "match" } });
  assert.equal(result.verdict, "pass");
});

test("risk engine: ADVERSE_MEDIA goes to enhanced due diligence review", async (t) => {
  const { result } = await orchestrate(t, { "/internal/aml/query": { status: "ADVERSE_MEDIA", matches: [] } });
  assert.equal(result.verdict, "review");
  assert.match(result.reason, /adverse media/i);
});

test("risk engine: unrecognised AML status goes to review", async (t) => {
  for (const status of ["UNKNOWN", "", "POSSIBLE_MATCH"]) {
    const { result } = await orchestrate(t, { "/internal/aml/query": { status, matches: [] } });
    assert.equal(result.verdict, "review", `status ${JSON.stringify(status)}`);
  }
});

test("risk engine: AML status is case-normalised", async (t) => {
  const { result } = await orchestrate(t, { "/internal/aml/query": { status: "clear", matches: [] } });
  assert.equal(result.verdict, "pass");
});

test("risk engine: CLEAR with a match score above 85 goes to review", async (t) => {
  for (const score of [86, 90, 100]) {
    const { result } = await orchestrate(t, {
      "/internal/aml/query": {
        status: "CLEAR",
        matches: [{ source: "OFAC_SDN", program: "SDGT", match_score: score, matched_country: null }],
      },
    });
    assert.equal(result.verdict, "review", `score ${score}`);
  }
});

test("risk engine: SANCTIONS_HIT rejects", async (t) => {
  const { result } = await orchestrate(t, { "/internal/aml/query": { status: "SANCTIONS_HIT", matches: [] } });
  assert.equal(result.verdict, "reject");
});

test("risk engine: malformed upstream responses go to review with a generic error code", async (t) => {
  const cases = [
    { "/internal/doc-scan": { fake_score: "0.01", flags: [], document_type: "id" } },
    { "/internal/doc-scan": { fake_score: 0.01, document_type: "id" } },
    { "/internal/liveness": { liveness_score: 0.99, confidence: 0.9 } },
    { "/internal/liveness": { liveness_score: 7, deepfake_flag: false, confidence: 0.9 } },
    { "/internal/iprs/query": { result: "MATCH" } },
    { "/internal/aml/query": { status: "CLEAR", matches: "none" } },
    { "/internal/aml/query": { status: "CLEAR", matches: [{ source: "OFAC_SDN", program: "X", match_score: "low" }] } },
    { "/internal/aml/query": () => new Response("<html>not json</html>", { status: 200 }) },
  ];
  for (const overrides of cases) {
    const { result } = await orchestrate(t, overrides);
    assert.equal(result.verdict, "review", JSON.stringify(overrides));
    const errors = Object.values(result.stepResults).filter((step) => step && "error" in step);
    assert.deepEqual(errors, [{ error: "upstream_invalid_response" }], JSON.stringify(overrides));
  }
});

test("risk engine: invalid IPRS responses are not retried", async (t) => {
  const { calls } = await orchestrate(t, { "/internal/iprs/query": { status: 42 } });
  assert.equal(calls.filter((call) => call === "/internal/iprs/query").length, 1);
});

test("risk engine: upstream error bodies never reach the result", async (t) => {
  const secret = "Traceback: db-password=hunter2 at internal-host-7";
  const { result } = await orchestrate(t, {
    "/internal/doc-scan": () => new Response(secret, { status: 500 }),
  });
  assert.equal(result.verdict, "review");
  assert.deepEqual(result.stepResults.docScan, { error: "upstream_http_error" });
  assert.ok(!JSON.stringify(result).includes("hunter2"));
});

test("risk engine: AML outage goes to review", async (t) => {
  const { result } = await orchestrate(t, {
    "/internal/aml/query": () => new Response("down", { status: 404 }),
  });
  assert.equal(result.verdict, "review");
  assert.deepEqual(result.stepResults.aml, { error: "upstream_http_error" });
});

// ── AML matching ───────────────────────────────────────────────────────────

function entry(overrides) {
  return {
    sourceKey: "OFAC_SDN",
    entityType: "individual",
    primaryName: "John Doe",
    aliases: [],
    normalizedNames: [],
    countries: [],
    isActive: true,
    ...overrides,
  };
}

test("AML matching assigns exact, alias and token-order match types", () => {
  const exact = matching.scoreCandidate("john  doé", "individual", undefined, entry({}));
  assert.equal(exact.method, "exact");
  assert.equal(exact.nameScore, 100);

  const alias = matching.scoreCandidate("Johnny Doe", "individual", undefined, entry({ aliases: ["JOHNNY DOE"] }));
  assert.equal(alias.method, "alias");

  const reordered = matching.scoreCandidate("Doe John", "individual", undefined, entry({}));
  assert.equal(reordered.method, "normalized");
  assert.ok(reordered.nameScore >= matching.STRONG_MATCH_THRESHOLD);

  const fuzzy = matching.scoreCandidate("Jon Doe", "individual", undefined, entry({}));
  assert.equal(fuzzy.method, "fuzzy");

  assert.equal(matching.scoreCandidate("Completely Different", "individual", undefined, entry({})), null);
});

test("AML matching does not screen individuals against entity entries", () => {
  assert.equal(matching.scoreCandidate("John Doe", "individual", undefined, entry({ entityType: "entity" })), null);
  assert.equal(matching.scoreCandidate("John Doe", "entity", undefined, entry({ entityType: "individual" })), null);
  assert.ok(matching.scoreCandidate("John Doe", "individual", undefined, entry({ entityType: "unknown" })));
});

test("AML decide considers every candidate, not just the first", () => {
  const fuzzy = { ...entry({}), nameScore: 99, method: "fuzzy", countryMatch: "unknown" };
  const exact = { ...entry({}), nameScore: 100, method: "alias", countryMatch: "unknown" };
  assert.equal(matching.decide([fuzzy, exact]).verdict, "reject");
  assert.equal(matching.decide([fuzzy]).verdict, "review");
  assert.equal(matching.decide([]).verdict, "pass");
});

test("AML country is a tie-breaker and never turns a match into a pass", () => {
  const listed = entry({ countries: ["Iran"] });
  const mismatch = matching.scoreCandidate("John Doe", "individual", "Kenya", listed);
  assert.equal(mismatch.countryMatch, "mismatch");
  assert.equal(matching.decide([mismatch]).verdict, "review");

  const corroborated = matching.scoreCandidate("John Doe", "individual", "iran", listed);
  assert.equal(corroborated.countryMatch, "match");
  assert.equal(matching.decide([mismatch, corroborated]).verdict, "reject");

  // An ISO code can't be compared with a country name: unknown, still reject.
  const code = matching.scoreCandidate("John Doe", "individual", "KE", listed);
  assert.equal(code.countryMatch, "unknown");
  assert.equal(matching.decide([code]).verdict, "reject");

  const sorted = [mismatch, corroborated].sort(matching.compareCandidates);
  assert.equal(sorted[0].countryMatch, "match");
});

// ── Watchlist parsers ──────────────────────────────────────────────────────

test("UN parser: alias names exclude QUALITY and ENTITY_ALIAS is parsed", () => {
  const xml = `<CONSOLIDATED_LIST><INDIVIDUALS>
    <INDIVIDUAL><DATAID>111</DATAID><FIRST_NAME>JOHN</FIRST_NAME><SECOND_NAME>DOE</SECOND_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE><REFERENCE_NUMBER>QDi.001</REFERENCE_NUMBER>
      <NATIONALITY><VALUE>Iraq</VALUE><VALUE>Syria</VALUE></NATIONALITY>
      <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Abu John</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>J. Doe</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS>
    </INDIVIDUAL></INDIVIDUALS><ENTITIES>
    <ENTITY><DATAID>222</DATAID><FIRST_NAME>ACME TRADING &amp; CO</FIRST_NAME>
      <ENTITY_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Acme Holdings</ALIAS_NAME></ENTITY_ALIAS>
      <ENTITY_ADDRESS><COUNTRY>Yemen</COUNTRY></ENTITY_ADDRESS>
    </ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
  const [person, company] = parsers.parseUn(xml);
  assert.equal(person.primaryName, "JOHN DOE");
  assert.equal(person.entityType, "individual");
  assert.deepEqual(person.aliases, ["Abu John", "J. Doe"]);
  assert.ok(person.normalizedNames.includes("ABU JOHN"));
  assert.deepEqual(person.countries, ["Iraq", "Syria"]);
  assert.deepEqual(person.programs, ["Al-Qaida", "QDi.001"]);
  assert.equal(company.primaryName, "ACME TRADING & CO");
  assert.equal(company.entityType, "entity");
  assert.deepEqual(company.aliases, ["Acme Holdings"]);
  assert.deepEqual(company.countries, ["Yemen"]);
});

test("OFAC parser: entry name and uid are not taken from nested aka records", () => {
  const xml = `<sdnList><sdnEntry><uid>36</uid><lastName>AEROCARIBBEAN AIRLINES</lastName><sdnType>Entity</sdnType>
    <programList><program>CUBA</program></programList>
    <akaList><aka><uid>12</uid><type>a.k.a.</type><firstName>Bogus</firstName><lastName>AERO-CARIBBEAN</lastName></aka></akaList>
    <addressList><address><uid>25</uid><city>Havana</city><country>Cuba</country></address></addressList>
    </sdnEntry></sdnList>`;
  const [row] = parsers.parseOfac(xml);
  assert.equal(row.sourceRecordId, "36");
  assert.equal(row.primaryName, "AEROCARIBBEAN AIRLINES");
  assert.equal(row.entityType, "entity");
  assert.deepEqual(row.aliases, ["Bogus AERO-CARIBBEAN"]);
  assert.deepEqual(row.countries, ["Cuba"]);
  assert.deepEqual(row.programs, ["CUBA"]);
});

test("XML decoding does not double-decode entities", () => {
  assert.equal(parsers.decodeXml("A &amp;lt; B &#38; C &#x41;"), "A &lt; B & C A");
});
