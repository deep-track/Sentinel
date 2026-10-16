const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative) {
  const { outputText } = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative });
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, require, module);
  return module.exports;
}

const tm = loadTs("backend/convex/lib/transactionRules.ts");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 12);
const RATE = 130;
const config = { ...tm.DEFAULT_MONITORING, callForAction: ["KP", "IR", "MM"], increasedMonitoring: ["KE", "NG", "VE"], homeCountry: "KE" };

let seq = 0;
const txn = (overrides = {}) => {
  const amount = overrides.amount ?? 10_000;
  const currency = overrides.currency ?? "KES";
  return { id: `t${++seq}`, occurredAt: NOW, amount, currency, amountUsd: tm.toUsd(amount, currency, RATE), direction: "in", channel: "mpesa", counterpartyName: null, counterpartyCountry: null, ...overrides, ...(overrides.amountUsd === undefined ? { amountUsd: tm.toUsd(amount, currency, RATE) } : {}) };
};
const run = (history, fresh) => tm.evaluateTransactions([...history, ...fresh].sort((a, b) => a.occurredAt - b.occurredAt), new Set(fresh.map((item) => item.id)), config);
const rules = (alerts) => alerts.map((alert) => alert.rule);

test("large cash: KES 2.5m in cash is over US$15,000; M-Pesa isn't cash", () => {
  const alerts = run([], [txn({ amount: 2_500_000, channel: "cash" })]);
  assert.deepEqual(rules(alerts), ["large_cash"]);
  assert.match(alerts[0].summary, /Cash deposit of KES 2,500,000/);
  assert.deepEqual(rules(run([], [txn({ amount: 2_500_000, channel: "mpesa" })])), []);
  assert.deepEqual(rules(run([], [txn({ amount: 900_000, channel: "cash" })])), [], "KES 900,000 is under US$15,000");
});

test("structuring: three deposits just under the threshold in a week", () => {
  const near = (daysAgo) => txn({ amount: 1_800_000, channel: "cash", occurredAt: NOW - daysAgo * DAY });
  const alerts = run([near(5), near(3)], [near(0)]);
  assert.deepEqual(rules(alerts), ["structuring"]);
  assert.equal(alerts[0].severity, "high");
  assert.equal(alerts[0].transactionIds.length, 3);
  assert.deepEqual(rules(run([near(20), near(15)], [near(0)])), [], "spread over three weeks");
});

test("velocity: a quiet customer suddenly moving large sums", () => {
  const history = Array.from({ length: 60 }, (_, index) => txn({ amount: 5_000, occurredAt: NOW - (index + 2) * DAY }));
  const alerts = run(history, [txn({ amount: 1_500_000, direction: "in" })]);
  assert.ok(rules(alerts).includes("velocity"));
  assert.match(alerts.find((alert) => alert.rule === "velocity").summary, /times this customer's usual daily volume/);
  assert.ok(!rules(run([], [txn({ amount: 1_500_000 })])).includes("velocity"), "no baseline for a new customer");
});

test("high-risk countries: call-for-action always, grey list from US$1,000, never the home country", () => {
  assert.equal(run([], [txn({ amount: 50, currency: "USD", channel: "swift", counterpartyCountry: "IR" })])[0].severity, "high");
  assert.deepEqual(rules(run([], [txn({ amount: 500, currency: "USD", channel: "swift", counterpartyCountry: "NG" })])), []);
  assert.equal(run([], [txn({ amount: 5_000, currency: "USD", channel: "swift", counterpartyCountry: "NG" })])[0].severity, "medium");
  assert.deepEqual(rules(run([], [txn({ amount: 50_000, currency: "USD", channel: "swift", counterpartyCountry: "KE" })])), [], "Kenya is grey-listed but home for a Kenyan client");
});

test("pass-through: an M-Pesa account receiving and sending on almost everything (a mule)", () => {
  const inflows = [txn({ amount: 800_000, occurredAt: NOW - 30 * 3_600_000 }), txn({ amount: 700_000, occurredAt: NOW - 20 * 3_600_000 })];
  const out = txn({ amount: 1_450_000, direction: "out" });
  const alerts = run(inflows, [out]);
  assert.ok(rules(alerts).includes("pass_through"));
  assert.match(alerts.find((alert) => alert.rule === "pass_through").summary, /within 48 hours \(97%\)/);
  assert.ok(!rules(run(inflows, [txn({ amount: 300_000, direction: "out" })])).includes("pass_through"), "most of the money stays");
});

test("dormant: nothing for 200 days, then KES 1m", () => {
  const alerts = run([txn({ amount: 2_000, occurredAt: NOW - 200 * DAY })], [txn({ amount: 1_000_000 })]);
  assert.ok(rules(alerts).includes("dormant_reactivated"));
  assert.match(alerts.find((alert) => alert.rule === "dormant_reactivated").summary, /after 200 days without activity/);
});

test("high-risk customers get tighter thresholds; large cash stays as the law sets it", () => {
  const high = tm.forRisk(config, "high");
  assert.equal(high.passThroughMinUsd, config.passThroughMinUsd / 2);
  assert.equal(high.largeCashUsd, config.largeCashUsd);
  assert.equal(tm.forRisk(config, "low"), config);
});

test("validation and CSV", () => {
  const ok = tm.cleanTransaction({ externalId: "T1", customerRef: "C1", occurredAt: "2026-10-16T09:30:00+03:00", amount: "150,000", direction: "IN", channel: "M-Pesa", counterpartyCountry: "ke" }, NOW);
  assert.equal(ok.amount, 150000);
  assert.equal(ok.channel, "mpesa");
  assert.equal(ok.direction, "in");
  assert.equal(ok.currency, "KES");
  assert.equal(ok.counterpartyCountry, "KE");
  assert.match(tm.cleanTransaction({ customerRef: "C1" }).error, /externalId/);
  assert.match(tm.cleanTransaction({ externalId: "T", customerRef: "C", occurredAt: "2026-10-16", amount: 5, direction: "in", currency: "UGX" }, NOW).error, /KES or USD/);
  assert.match(tm.cleanTransaction({ externalId: "T", customerRef: "C", occurredAt: "2099-01-01", amount: 5, direction: "in" }, NOW).error, /future/);
  const rows = tm.parseTransactionCsv(tm.CSV_TEMPLATE + 'TX-2,CUST-2,2026-10-16T10:00:00Z,"1,000",KES,out,cash,"Doe, John",KE,,"Rent, October"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].counterpartyName, "Doe, John");
  assert.equal(rows[1].narration, "Rent, October");
  assert.equal(tm.cleanTransaction(rows[0], NOW).amount, 150000);
});

test("wiring: API, scopes, alerts, counterparty screening without adverse media, portal", () => {
  const http = read("backend/convex/http.ts");
  assert.match(http, /path: "\/v1\/transactions"/);
  assert.match(read("backend/convex/apiKeys.ts"), /route\.startsWith\("POST \/v1\/transactions"\)\) return "monitoring"/);
  const backend = read("backend/convex/transactions.ts");
  assert.match(backend, /if \(args\.environment === "test"\)/, "test keys store nothing");
  assert.match(backend, /screenSubjects\(ctx, subjects, undefined, \{ adverseMedia: false \}\)/);
  assert.match(backend, /event: "transaction_alert"/);
  assert.match(backend, /withIndex\("by_client_and_external"/, "idempotent per externalId");
  assert.match(read("backend/convex/aml.ts"), /options\?\.adverseMedia === false \? Promise\.resolve/);
  assert.match(read("backend/convex/lib/clientSettings.ts"), /transaction_alert: \{ enabled: true, email: true/);
  assert.match(read("components/app-sidebar.tsx"), /url: "\/transactions"/);
});
