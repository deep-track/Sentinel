const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Transaction monitoring follow-ups: per-client thresholds, retention of
// transactions, alerts and counterparty screenings, and an STR from an alert.

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

const tm = loadTs("backend/convex/lib/transactionRules.ts");
const settings = loadTs("backend/convex/lib/clientSettings.ts");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15);
const YEARS = (n) => NOW - n * 365 * DAY;
const RATE = 130;
const FATF = { callForAction: ["KP", "IR", "MM"], increasedMonitoring: ["KE", "NG", "VE"], homeCountry: "KE" };

let seq = 0;
const txn = (overrides = {}) => {
  const amount = overrides.amount ?? 10_000;
  const currency = overrides.currency ?? "KES";
  return { id: `t${++seq}`, occurredAt: Date.UTC(2026, 9, 16, 12), amount, currency, direction: "in", channel: "mpesa", counterpartyName: null, counterpartyCountry: null, ...overrides, amountUsd: tm.toUsd(amount, currency, RATE) };
};
const run = (history, fresh, config) => tm.evaluateTransactions([...history, ...fresh].sort((a, b) => a.occurredAt - b.occurredAt), new Set(fresh.map((item) => item.id)), config);

// ── Per-client thresholds ───────────────────────────────────────────────────

test("thresholds: the defaults are DEFAULT_MONITORING, in whole percentages", () => {
  const defaults = tm.thresholdsFromConfig();
  assert.equal(defaults.structuringPercent, 70);
  assert.equal(defaults.passThroughPercent, 90);
  assert.deepEqual(tm.configFromThresholds(defaults), tm.DEFAULT_MONITORING);
  assert.deepEqual(settings.resolveSettings(null).screening.transactionMonitoring, defaults);
  const resolved = settings.resolveSettings({ screening: { transactionMonitoring: { largeCashUsd: 10_000, dormantDays: 365 } } }).screening.transactionMonitoring;
  assert.equal(resolved.largeCashUsd, 10_000);
  assert.equal(resolved.dormantDays, 365);
  assert.equal(resolved.velocityMultiple, defaults.velocityMultiple, "unset fields keep the default");
});

test("thresholds: validated on save; large cash can't go above the legal US$15,000", () => {
  const known = { adverseMedia: [], poaDocuments: [] };
  const save = (transactionMonitoring) => settings.validateScreeningSettings({ transactionMonitoring }, known);
  assert.throws(() => save({ largeCashUsd: 20_000 }), /large cash threshold \(US\$\) must be a whole number from 1000 to 15000/);
  assert.throws(() => save({ structuringPercent: 99 }), /structuring band/);
  assert.throws(() => save({ structuringMinCount: 2.5 }), /whole number/);
  assert.throws(() => save({ passThroughHours: 0 }), /pass-through window/);
  assert.throws(() => save({ dormantDays: 5 }), /dormancy period/);
  assert.deepEqual(save({ largeCashUsd: 10_000, passThroughPercent: 100, dormantDays: 365 }).transactionMonitoring, { largeCashUsd: 10_000, passThroughPercent: 100, dormantDays: 365 });
  for (const [key, limit] of Object.entries(tm.MONITORING_LIMITS)) {
    const value = tm.thresholdsFromConfig()[key];
    assert.ok(value >= limit.min && value <= limit.max, `the default ${key} is allowed`);
  }
});

test("thresholds: a client's own values change what the rules raise", () => {
  const lowered = { ...tm.configFromThresholds({ ...tm.thresholdsFromConfig(), largeCashUsd: 5_000 }), ...FATF };
  const standard = { ...tm.DEFAULT_MONITORING, ...FATF };
  const cash = () => txn({ amount: 900_000, channel: "cash" });
  assert.deepEqual(run([], [cash()], standard).map((alert) => alert.rule), [], "KES 900,000 is under US$15,000");
  const alerts = run([], [cash()], lowered);
  assert.deepEqual(alerts.map((alert) => alert.rule), ["large_cash"]);
  assert.match(alerts[0].summary, /US\$5,000 reporting threshold/);

  const yearLong = { ...tm.configFromThresholds({ ...tm.thresholdsFromConfig(), dormantDays: 365 }), ...FATF };
  const last = txn({ amount: 2_000, occurredAt: Date.UTC(2026, 9, 16, 12) - 400 * DAY });
  assert.ok(run([last], [txn({ amount: 1_000_000 })], yearLong).some((alert) => alert.rule === "dormant_reactivated"), "400 days dormant");
  assert.ok(!run([txn({ amount: 2_000, occurredAt: Date.UTC(2026, 9, 16, 12) - 200 * DAY })], [txn({ amount: 1_000_000 })], yearLong).some((alert) => alert.rule === "dormant_reactivated"));
});

test("thresholds wiring: monitoringConfig, the history before the window, the settings page", () => {
  const backend = read("backend/convex/transactions.ts");
  assert.match(backend, /configFromThresholds\(settings\.screening\.transactionMonitoring\)/);
  assert.match(backend, /\.lt\("occurredAt", since\)\)\s*\.order\("desc"\)\s*\.first\(\)/, "the last transaction before the window, for dormancy");
  assert.doesNotMatch(backend, /DEFAULT_MONITORING/);
  const page = read("app/(platform)/settings/screening/screening-settings.tsx");
  assert.match(page, /title="Transaction monitoring"/);
  assert.match(page, /MONITORING_LIMITS\[field\.key\]\.max/);
  assert.match(page, /transactionMonitoring: draft\.transactionMonitoring/);
  assert.match(read("components/settings/kit.tsx"), /transactionMonitoring: MonitoringThresholds/);
});

// ── Retention ───────────────────────────────────────────────────────────────

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

function setupRetention(tables) {
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
  const all = { verifications: [], transactions: [], transactionAlerts: [], counterpartyScreenings: [], retentionPurges: [], ...tables };
  const ctx = {
    db: fakeDb(all),
    auth: { getUserIdentity: async () => ({ name: "Admin" }) },
    scheduler: { runAfter: async (_ms, fn, args) => record.scheduled.push({ fn, args }) },
  };
  return { mod, ctx, tables: all, record, as: (next) => (user = next) };
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

const stored = (id, clientId, years, extra = {}) => ({ _id: id, clientId, externalId: id, customerRef: "CUST-1", occurredAt: YEARS(years), amount: 1_000_000, currency: "KES", amountUsd: 7_692, direction: "in", channel: "cash", counterpartyName: "Jane Doe", source: "api", createdAt: YEARS(years), ...extra });
const alertRow = (id, clientId, status, transactionIds, createdAt, extra = {}) => ({ _id: id, clientId, customerRef: "CUST-1", rule: "large_cash", severity: "medium", status, summary: "Cash deposit of KES 1,000,000 from Jane Doe.", transactionIds, key: id, createdAt, ...extra });

async function approveAndRun(mod, ctx, tables, as) {
  const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
  as({ userId: "admin-2", role: "client_admin" });
  await mod.approve.handler(ctx, { purgeId });
  let runs = 0;
  while (tables.retentionPurges[0].status === "running" && runs < 20) {
    await mod.runPurge.handler(ctx, { purgeId });
    runs += 1;
  }
  return runs;
}

test("retention: old transactions go, alerts lose them, decided alerts keep a minimal record, open alerts hold theirs", () =>
  atNow(async () => {
    const { mod, ctx, tables, record, as } = setupRetention({
      transactions: [
        stored("old-closed", "c1", 9),
        stored("old-esc", "c1", 9),
        stored("new-esc", "c1", 1),
        stored("old-open", "c1", 8),
        stored("old-free", "c1", 8),
        stored("recent", "c1", 1),
        stored("other", "c2", 9),
      ],
      transactionAlerts: [
        alertRow("a-closed", "c1", "closed", ["old-closed"], YEARS(9), { decidedAt: YEARS(9), decidedBy: "user-1", decisionNotes: "Rent paid to Jane Doe, lease on file." }),
        alertRow("a-esc", "c1", "escalated", ["old-esc", "new-esc"], YEARS(1)),
        alertRow("a-open", "c1", "open", ["old-open"], YEARS(8)),
        alertRow("a-other", "c2", "closed", ["other"], YEARS(9)),
      ],
      counterpartyScreenings: [
        { _id: "s-old", clientId: "c1", key: "JANE DOE", name: "Jane Doe", verdict: "pass", reason: "clear", screenedAt: YEARS(8) },
        { _id: "s-new", clientId: "c1", key: "JOHN DOE", name: "John Doe", verdict: "pass", reason: "clear", screenedAt: YEARS(0.1) },
        { _id: "s-other", clientId: "c2", key: "JANE DOE", name: "Jane Doe", verdict: "pass", reason: "clear", screenedAt: YEARS(8) },
      ],
    });

    const overview = await mod.overview.handler(ctx, { clientId: "c1" });
    assert.equal(overview.pastRetention, 0, "no checks");
    assert.equal(overview.pastRetentionTransactions, 4, "a removal can be asked for transactions alone");

    const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
    assert.equal(tables.retentionPurges[0].estimatedTransactions, 4);
    await assert.rejects(mod.approve.handler(ctx, { purgeId }), /Another Admin/, "four-eyes as for checks");
    assert.equal(tables.transactions.length, 7, "nothing removed before approval");
    as({ userId: "admin-2", role: "client_admin" });
    await mod.approve.handler(ctx, { purgeId });
    await mod.runPurge.handler(ctx, { purgeId });

    const purge = tables.retentionPurges[0];
    assert.equal(purge.status, "completed");
    assert.deepEqual(purge.transactions, { removed: 3, held: 1, alertsTrimmed: 2, alertsMinimized: 1, screeningsRemoved: 1 });
    assert.deepEqual(tables.transactions.map((row) => row._id).sort(), ["new-esc", "old-open", "other", "recent"]);

    const closed = tables.transactionAlerts.find((row) => row._id === "a-closed");
    assert.deepEqual(closed.transactionIds, []);
    assert.equal(closed.summary, "Removed after the retention period.");
    assert.equal(closed.decisionNotes, undefined);
    assert.equal(closed.status, "closed", "rule, severity, decision and dates stay");
    assert.equal(closed.rule, "large_cash");
    assert.equal(closed.decidedBy, "user-1");
    const escalated = tables.transactionAlerts.find((row) => row._id === "a-esc");
    assert.deepEqual(escalated.transactionIds, ["new-esc"]);
    assert.match(escalated.summary, /Jane Doe/, "an alert with transactions left keeps its summary");
    assert.deepEqual(tables.transactionAlerts.find((row) => row._id === "a-open").transactionIds, ["old-open"]);
    assert.deepEqual(tables.transactionAlerts.find((row) => row._id === "a-other").transactionIds, ["other"], "another client's data is untouched");

    assert.deepEqual(tables.counterpartyScreenings.map((row) => row._id).sort(), ["s-new", "s-other"]);
    const completed = record.audits.find((entry) => entry.action === "retention.purge_completed");
    assert.equal(completed.metadata.transactions.removed, 3);
  }));

test("retention: many transactions are removed in batches, one stage after another", () =>
  atNow(async () => {
    const transactions = Array.from({ length: 450 }, (_, index) => stored(`bulk${index}`, "c1", 10, { occurredAt: YEARS(10) + index }));
    const { mod, ctx, tables, record, as } = setupRetention({ transactions, transactionAlerts: [alertRow("a1", "c1", "closed", ["bulk0", "bulk449"], YEARS(10))] });
    const { purgeId } = await mod.request.handler(ctx, { clientId: "c1" });
    assert.equal(tables.retentionPurges[0].estimatedTransactions, 450);
    as({ userId: "internal", role: "internal_admin" });
    await mod.approve.handler(ctx, { purgeId });
    await mod.runPurge.handler(ctx, { purgeId });
    assert.equal(tables.retentionPurges[0].phase, "transactions", "the checks stage finished at once; transactions continue");
    assert.equal(tables.retentionPurges[0].status, "running");
    let runs = 1;
    while (tables.retentionPurges[0].status === "running" && runs < 20) {
      await mod.runPurge.handler(ctx, { purgeId });
      runs += 1;
    }
    assert.equal(runs, 3);
    assert.equal(tables.transactions.length, 0);
    assert.equal(tables.retentionPurges[0].transactions.removed, 450);
    assert.equal(tables.transactionAlerts[0].summary, "Removed after the retention period.");
    assert.equal(record.scheduled.filter((item) => item.fn === "runPurge").length, 3, "approve, then two more batches");
  }));

test("retention: checks and transactions in the same removal; recent data is never touched", () =>
  atNow(async () => {
    const { mod, ctx, tables, as } = setupRetention({
      verifications: [{ _id: "v1", clientId: "c1", type: "aml", status: "completed", verdict: "pass", reference: "CUST-1", input: { subjectName: "Jane" }, result: {}, createdAt: YEARS(9), updatedAt: YEARS(9) }],
      transactions: [stored("old", "c1", 9), stored("recent", "c1", 6.9)],
      reviewQueue: [],
      amlMonitoredSubjects: [],
      strReports: [],
      amlClearedMatches: [],
    });
    await approveAndRun(mod, ctx, tables, as);
    const purge = tables.retentionPurges[0];
    assert.equal(purge.purged, 1);
    assert.equal(purge.transactions.removed, 1);
    assert.deepEqual(tables.transactions.map((row) => row._id), ["recent"], "6.9 years is inside the 7-year period");
    assert.deepEqual(tables.verifications[0].input, { purged: true });
  }));

test("retention wiring: indexes, the settings page", () => {
  const schema = read("backend/convex/schema.ts");
  assert.match(schema, /\.index\("by_client_and_occurred_at", \["clientId", "occurredAt"\]\)/);
  assert.match(schema, /\.index\("by_client_and_screened_at", \["clientId", "screenedAt"\]\)/);
  assert.match(schema, /\.index\("by_client_and_created_at", \["clientId", "createdAt"\]\),\s*\n\s*counterpartyScreenings/);
  const ui = read("components/settings/retention-removal.tsx");
  assert.match(ui, /pastRetentionTransactions/);
  assert.match(ui, /transactionsText\(purge\.transactions\)/);
});

// ── STR from an alert ───────────────────────────────────────────────────────

test("STR from an alert: the largest transaction in US dollars and the alert summary as the reason", () => {
  const rows = [
    { externalId: "TX-1", occurredAt: 1, amount: 1_500_000, currency: "KES", amountUsd: 11_538, direction: "in", channel: "mpesa", counterpartyName: "Jane Doe", counterpartyAccount: "0712345678", narration: null },
    { externalId: "TX-2", occurredAt: 2, amount: 20_000, currency: "USD", amountUsd: 20_000, direction: "out", channel: "swift", counterpartyName: "Acme FZE", counterpartyAccount: null, narration: "Invoice 42" },
  ];
  const str = tm.strFromAlert({ rule: "pass_through", summary: "KES 1,500,000 came in and USD 20,000 went out within 48 hours (99%)." }, rows);
  assert.equal(str.reason, "Money in and straight out: KES 1,500,000 came in and USD 20,000 went out within 48 hours (99%).");
  assert.equal(str.transaction.number, "TX-2", "USD 20,000 is more than KES 1.5m");
  assert.equal(str.transaction.amount, 20_000);
  assert.equal(str.transaction.description, "SWIFT sent: USD 20,000 (Invoice 42)");
  assert.equal(str.transaction.counterpartyName, "Acme FZE");
  assert.equal(str.transaction.counterpartyAccount, "");
  assert.equal(tm.strFromAlert({ rule: "large_cash", summary: "x" }, []).transaction, null, "no transactions left: SAR");
});

test("STR from an alert: prepare links the alert, only for the same customer", () =>
  atNow(async () => {
    const audits = [];
    const mod = loadTs("backend/convex/strReports.ts", {
      "./_generated/server": { mutation: (d) => d, query: (d) => d },
      "./lib/rbac": { requireClientRole: async () => ({ userId: "reviewer-1", role: "reviewer" }) },
      "./lib/clientSettings": { loadClientSettings: async () => ({ profile: { goamlEntityId: "1234", complianceContactName: "Mary MLRO" } }) },
      "./auditLog": { recordAudit: async (_ctx, entry) => audits.push(entry), actorTypeForClientRole: () => "client_user" },
      "./reviewQueue": { displayName: () => "Reviewer" },
    });
    const tables = {
      verifications: [{ _id: "v1", clientId: "c1", type: "aml", reference: "CUST-1", input: { subjectName: "Jane Doe" } }],
      transactionAlerts: [alertRow("a1", "c1", "escalated", [], 1), alertRow("a2", "c1", "open", [], 1, { customerRef: "CUST-2" })],
      strReports: [],
    };
    const ctx = { db: fakeDb(tables), auth: { getUserIdentity: async () => ({ name: "Reviewer" }) } };
    const args = (transactionAlertId) => ({
      verificationId: "v1",
      transactionAlertId,
      reportCode: "STR",
      reason: "Money in and straight out.",
      action: "Escalated.",
      indicators: [],
      transaction: { number: "TX-2", date: NOW, amount: 20_000, description: "SWIFT sent" },
    });
    await assert.rejects(mod.prepare.handler(ctx, args("a2")), /isn't for this customer/);
    const { strId } = await mod.prepare.handler(ctx, args("a1"));
    const report = tables.strReports.find((row) => row._id === strId);
    assert.equal(report.transactionAlertId, "a1");
    assert.equal(report.transaction.number, "TX-2");
  }));

test("STR from an alert wiring: the alert page and the dialog prefill", () => {
  const page = read("app/(platform)/transactions/alerts/[id]/alert-detail.tsx");
  assert.match(page, /alert\.customerCheck && alert\.canReport \? \(\s*<StrPanel/);
  assert.match(page, /strFromAlert\(alert, alert\.transactions\)/);
  assert.match(page, /transactionAlertId: alert\._id/);
  const backend = read("backend/convex/transactions.ts");
  assert.match(backend, /canReport: STR_ROLES\.includes\(actor\.role\)/);
  assert.match(backend, /!verification\.purgedAt/, "no STR from a check whose data was removed");
  const dialog = read("components/reports/str-dialog.tsx");
  assert.match(dialog, /useState<"SAR" \| "STR">\(prefill\?\.reportCode \?\? "SAR"\)/);
  assert.match(dialog, /\.\.\.prefill\?\.transaction/);
  assert.match(dialog, /transactionAlertId: prefill\.transactionAlertId/);
  assert.match(read("backend/convex/schema.ts"), /transactionAlertId: v\.optional\(v\.id\("transactionAlerts"\)\)/);
});
