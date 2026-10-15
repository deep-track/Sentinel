const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative, stubs = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  });
  const module = { exports: {} };
  cache.set(relative, module.exports);
  const localRequire = (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = path.resolve(path.dirname(path.join(root, relative)), specifier);
    return loadTs(path.relative(root, resolved.endsWith(".ts") ? resolved : `${resolved}.ts`), stubs, cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const lib = loadTs("backend/convex/lib/retention.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15);
const YEARS = (n) => NOW - n * 365 * DAY;

test("cutoff and holds", () => {
  assert.equal(lib.retentionCutoff(84, Date.UTC(2026, 9, 15)), Date.UTC(2019, 9, 15));
  assert.equal(lib.holdReason({ status: "completed", hasOpenCase: false, hasActiveMonitoring: false, hasStr: false }), null);
  assert.equal(lib.holdReason({ status: "processing", hasOpenCase: false, hasActiveMonitoring: false, hasStr: false }), "unfinished");
  assert.equal(lib.holdReason({ status: "completed", hasOpenCase: true, hasActiveMonitoring: true, hasStr: true }), "openCase");
  assert.equal(lib.holdReason({ status: "failed", hasOpenCase: false, hasActiveMonitoring: true, hasStr: false }), "monitoring");
  assert.equal(lib.holdReason({ status: "completed", hasOpenCase: false, hasActiveMonitoring: false, hasStr: true }), "str");
});

// ── The flow, on a fake database ────────────────────────────────────────────

function fakeDb(tables) {
  let next = 1;
  const find = (id) => {
    for (const rows of Object.values(tables)) {
      const row = rows.find((item) => item._id === id);
      if (row) return row;
    }
    return null;
  };
  return {
    get: async (id) => find(id),
    insert: async (table, row) => {
      const _id = `${table}:${next++}`;
      (tables[table] ??= []).push({ _id, ...row });
      return _id;
    },
    patch: async (id, changes) => {
      const row = find(id);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    delete: async (id) => {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((item) => item._id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
    query: (table) => {
      const filters = [];
      let sortKey = null;
      let desc = false;
      const rows = () => {
        const matched = (tables[table] ?? []).filter((row) => filters.every((check) => check(row)));
        if (sortKey) matched.sort((a, b) => a[sortKey] - b[sortKey]);
        return desc ? matched.reverse() : matched;
      };
      const query = {
        withIndex: (_name, build) => {
          const builder = {
            eq: (field, value) => (filters.push((row) => row[field] === value), builder),
            lt: (field, value) => ((sortKey = field), filters.push((row) => row[field] < value), builder),
            gt: (field, value) => ((sortKey = field), filters.push((row) => row[field] > value), builder),
          };
          if (build) build(builder);
          return query;
        },
        order: (direction) => ((desc = direction === "desc"), query),
        take: async (n) => rows().slice(0, n),
        first: async () => rows()[0] ?? null,
      };
      return query;
    },
  };
}

function setup() {
  const record = { audits: [], scheduled: [] };
  let user = { userId: "admin-1", role: "client_admin" };
  const mod = loadTs("backend/convex/retention.ts", {
    "./_generated/server": { mutation: (d) => d, query: (d) => d, internalMutation: (d) => d },
    "./_generated/api": { internal: { retention: { runPurge: "runPurge" } } },
    "./lib/rbac": { requireClientRole: async () => user },
    "./lib/clientSettings": { loadClientSettings: async () => ({ data: { retentionMonths: 84 } }) },
    "./auditLog": { recordAudit: async (_ctx, entry) => record.audits.push(entry), actorTypeForClientRole: () => "client_user" },
    "./reviewQueue": { displayName: () => "Admin" },
  });
  const check = (id, years, extra = {}) => ({
    _id: id,
    clientId: "c1",
    type: "aml",
    status: "completed",
    verdict: "pass",
    creditsUsed: 1,
    reference: `ref_${id}`,
    input: { subjectName: `Person ${id}`, idNumber: "12345678" },
    result: { reason: "clear" },
    createdAt: YEARS(years),
    updatedAt: YEARS(years),
    ...extra,
  });
  const tables = {
    verifications: [
      check("old1", 9, { disputeReason: "x" }),
      check("old2", 8),
      check("heldCase", 9),
      check("heldMon", 9),
      check("heldStr", 9),
      check("recent", 2),
      { ...check("otherClient", 9), clientId: "c2" },
    ],
    flaggedEntities: [{ _id: "f1", verificationId: "old1", entityName: "Hit" }],
    kybDirectors: [{ _id: "k1", kybVerificationId: "old2", firstName: "Jane" }],
    webhookDeliveries: [{ _id: "w1", verificationId: "old1", payload: { name: "Person old1" } }],
    reviewQueue: [
      { _id: "r1", verificationId: "old1", status: "resolved", triggerReason: "Person old1 matched", resolutionNotes: "ok", createdAt: 1 },
      { _id: "r2", verificationId: "heldCase", status: "pending", triggerReason: "open", createdAt: 1 },
    ],
    amlMonitoredSubjects: [{ _id: "m1", enrolledVerificationId: "heldMon", status: "active" }],
    strReports: [{ _id: "s1", verificationId: "heldStr" }],
    feedbackLabels: [],
    livenessRequests: [],
    kybRegistryLookups: [],
    kyiRecords: [],
    amlClearedMatches: [
      { _id: "cm1", clientId: "c1", clearedAt: YEARS(9) },
      { _id: "cm2", clientId: "c1", clearedAt: YEARS(1) },
    ],
    retentionPurges: [],
  };
  const ctx = {
    db: fakeDb(tables),
    auth: { getUserIdentity: async () => ({ name: "Admin" }) },
    scheduler: { runAfter: async (_ms, fn, args) => record.scheduled.push({ fn, args }) },
  };
  return { mod, ctx, tables, record, as: (next) => (user = next) };
}

async function atNow(fn) {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    await fn();
  } finally {
    Date.now = realNow;
  }
}

test("a removal needs a second Admin, then removes personal data and keeps the minimal record", () =>
  atNow(async () => {
    const { mod, ctx, tables, record, as } = setup();
    const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
    const purge = tables.retentionPurges[0];
    assert.equal(purge.status, "pending_approval");
    assert.equal(purge.estimated, 5, "the 5 old checks of this client");
    await assert.rejects(mod.request.handler(ctx, { clientId: "c1" }), /already waiting/);

    await assert.rejects(mod.approve.handler(ctx, { purgeId }), /Another Admin/, "not by the requester");
    assert.equal(tables.verifications.find((row) => row._id === "old1").input.subjectName, "Person old1", "nothing removed before approval");

    as({ userId: "admin-2", role: "client_admin" });
    await mod.approve.handler(ctx, { purgeId });
    assert.equal(purge.status, "running");
    assert.deepEqual(record.scheduled.map((item) => item.fn), ["runPurge"]);

    await mod.runPurge.handler(ctx, { purgeId });
    assert.equal(purge.status, "completed");
    assert.equal(purge.purged, 2);
    assert.equal(purge.held, 3);
    assert.deepEqual(purge.holds, { openCase: 1, monitoring: 1, str: 1, unfinished: 0 });

    const old1 = tables.verifications.find((row) => row._id === "old1");
    assert.deepEqual(old1.input, { purged: true });
    assert.equal(old1.result.purged, true);
    assert.equal(old1.disputeReason, undefined);
    assert.equal(old1.reference, "ref_old1", "reference, type and verdict stay");
    assert.equal(old1.verdict, "pass");
    assert.equal(old1.purgedAt, NOW);
    assert.equal(tables.flaggedEntities.length, 0);
    assert.equal(tables.kybDirectors.length, 0);
    assert.equal(tables.webhookDeliveries.length, 0);
    const review = tables.reviewQueue.find((row) => row._id === "r1");
    assert.equal(review.resolutionNotes, undefined);
    assert.match(review.triggerReason, /Removed/);
    assert.deepEqual(tables.amlClearedMatches.map((row) => row._id), ["cm2"], "old cleared-hit memory goes, recent stays");

    for (const id of ["heldCase", "heldMon", "heldStr", "recent", "otherClient"]) {
      assert.ok(tables.verifications.find((row) => row._id === id).input.subjectName, `${id} is kept`);
    }
    assert.deepEqual(record.audits.map((entry) => entry.action), ["retention.purge_requested", "retention.purge_approved", "retention.purge_completed"]);
  }));

test("a pending removal can be cancelled; with nothing past retention there's nothing to request", () =>
  atNow(async () => {
    const { mod, ctx, tables } = setup();
    const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
    await mod.cancel.handler(ctx, { purgeId });
    assert.equal(tables.retentionPurges[0].status, "cancelled");
    await assert.rejects(mod.approve.handler(ctx, { purgeId }), /no longer waiting/);
    tables.verifications = tables.verifications.filter((row) => row.createdAt > YEARS(3));
    ctx.db = fakeDb(tables);
    await assert.rejects(mod.request.handler(ctx, { clientId: "c1" }), /No checks are past/);
  }));

test("large removals run in batches, and DeepTrack can approve", () =>
  atNow(async () => {
    const { mod, ctx, tables, record, as } = setup();
    for (let i = 0; i < 120; i++) {
      tables.verifications.push({ _id: `bulk${i}`, clientId: "c1", status: "completed", verdict: "pass", input: { subjectName: "x" }, createdAt: YEARS(10) + i, updatedAt: 0, reference: `b${i}` });
    }
    const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
    as({ userId: "internal", role: "internal_admin" });
    await mod.approve.handler(ctx, { purgeId });
    let runs = 0;
    while (tables.retentionPurges[0].status === "running" && runs < 10) {
      await mod.runPurge.handler(ctx, { purgeId });
      runs += 1;
    }
    assert.ok(runs >= 3, `ran in ${runs} batches`);
    assert.equal(tables.retentionPurges[0].purged, 122);
    assert.ok(record.scheduled.filter((item) => item.fn === "runPurge").length >= 3);
  }));
