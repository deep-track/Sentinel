const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// ── Service health ──────────────────────────────────────────────────────────

test("service health: configuration reports presence only, never values", () => {
  const health = read("backend/convex/backOfficeHealth.ts");
  assert.match(health, /function envSet\(key: string\) \{\s*return Boolean\(process\.env\[key\]\?\.trim\(\)\);/);
  assert.match(health, /const config = CONFIG\.map\(\(item\) => \(\{ \.\.\.item, set: envSet\(item\.key\) \}\)\)/);
  assert.doesNotMatch(health, /value: process\.env/, "no env value is returned");
});

test("service health: reads need an internal role, actions need internal_admin", () => {
  const health = read("backend/convex/backOfficeHealth.ts");
  const query = health.slice(health.indexOf("export const serviceHealth"));
  assert.match(query.slice(0, 200), /await requireInternalUser\(ctx\)/);
  for (const name of ["runChecksNow", "retryWebhookDelivery"]) {
    const fn = health.slice(health.indexOf(`export const ${name}`));
    assert.match(fn.slice(0, 300), /await requireInternalAdmin\(ctx, "write"\)/, `${name} requires internal_admin`);
    assert.match(fn, /recordAudit\(ctx/, `${name} is audited`);
  }
});

test("service health: probes run every 15 minutes and keep 7 days", () => {
  assert.match(read("backend/convex/crons.ts"), /crons\.interval\("probe external services", \{ minutes: 15 \}, internal\.backOfficeHealth\.runHealthChecks/);
  const health = read("backend/convex/backOfficeHealth.ts");
  assert.match(health, /const CHECK_RETENTION_MS = 7 \* DAY_MS/);
  assert.match(health, /q\.lt\("checkedAt", args\.checkedAt - CHECK_RETENTION_MS\)/);
  assert.match(read("backend/convex/schema.ts"), /serviceHealthChecks: defineTable/);
});

test("service health: a reachable service without its key is reported down", () => {
  const health = read("backend/convex/backOfficeHealth.ts");
  assert.match(health, /Reachable, but DEEPTRACK_LIVE_API_KEY is not set/);
  assert.match(health, /Reachable, but OPENSANCTIONS_API_KEY is not set/);
  assert.match(health, /\/v1\/client\/usage\/me`, \{ "X-API-Key": dtKey \}/, "the probe proves the DeepTrack key works");
});

test("back office is named Sentinel Back Office everywhere", () => {
  assert.match(read("components/app-sidebar.tsx"), /title: "Sentinel Back Office", url: "\/internal-ops"/);
  assert.match(read("app/internal-ops/layout.tsx"), /caption="Sentinel Back Office · internal"/);
  for (const file of ["components/app-sidebar.tsx", "app/internal-ops/layout.tsx", "app/internal-ops/ops-nav.tsx"]) {
    assert.doesNotMatch(read(file), /Sentinel Ops/, file);
  }
});

// Loads a Convex module with its imports stubbed, so pure helpers can be called.
function loadWithStubs(file) {
  const ts = require("typescript");
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  // Every property and call returns the stub itself, so validator chains like
  // v.object({ x: v.number() }) and query({...}) evaluate harmlessly.
  const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
  const mod = { exports: {} };
  new Function("exports", "require", "module", outputText)(mod.exports, () => stub, mod);
  return mod.exports;
}

// ── Revenue and billing ─────────────────────────────────────────────────────

const billing = loadWithStubs("backend/convex/backOfficeBilling.ts");

test("billing: usage counts deductions minus refunds, never allocations or adjustments", () => {
  assert.equal(billing.creditsUsed({ type: "deduction", amount: -3 }), 3);
  assert.equal(billing.creditsUsed({ type: "refund", amount: 1 }), -1);
  assert.equal(billing.creditsUsed({ type: "allocation", amount: 1000 }), 0);
  assert.equal(billing.creditsUsed({ type: "adjustment", amount: -50 }), 0);
});

test("billing: run-out forecast from the recent daily rate", () => {
  assert.equal(billing.daysUntilEmpty(70, 140, 14), 7);
  assert.equal(billing.daysUntilEmpty(0, 14, 14), 0);
  assert.equal(billing.daysUntilEmpty(500, 0, 14), null, "no usage, no forecast");
  assert.equal(billing.daysUntilEmpty(10, 28, 14), 5);
});

test("billing: reads need an internal role; pricing needs internal_admin, is validated and audited", () => {
  const source = read("backend/convex/backOfficeBilling.ts");
  for (const name of ["overview", "statement"]) {
    const fn = source.slice(source.indexOf(`export const ${name}`));
    assert.match(fn.slice(0, 400), /await requireInternalUser\(ctx\)/, name);
  }
  const setPricing = source.slice(source.indexOf("export const setPricing"));
  assert.match(setPricing.slice(0, 500), /await requireInternalAdmin\(ctx, "write"\)/);
  assert.match(setPricing, /\/\^\[A-Z\]\{3\}\$\//, "three-letter currency");
  assert.match(setPricing, /action: "billing\.pricing_updated"/);
  assert.match(setPricing, /before: existing \?/, "before/after values are audited");
});

test("billing: unbilled work = open review items with no deduction yet", () => {
  const source = read("backend/convex/backOfficeBilling.ts");
  assert.match(source, /withIndex\("by_verification", \(q\) => q\.eq\("verificationId", item\.verificationId\)\)\s*\.filter\(\(q\) => q\.eq\(q\.field\("type"\), "deduction"\)\)/);
  assert.match(source, /if \(charged\) return null;/);
});

// ── Client health ───────────────────────────────────────────────────────────

const clientsModule = loadWithStubs("backend/convex/backOfficeClients.ts");
const DAY = 24 * 60 * 60 * 1000;

test("client health: churn warning needs a real baseline and a 50% drop", () => {
  assert.equal(clientsModule.churnRisk(5, 10), true);
  assert.equal(clientsModule.churnRisk(6, 10), false);
  assert.equal(clientsModule.churnRisk(0, 9), false, "too small a baseline to judge");
  assert.equal(clientsModule.churnRisk(0, 40), true);
});

test("client health: API key flags", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(clientsModule.keyFlags({ revoked: false, createdAt: now - DAY }, now), ["never used"]);
  assert.deepEqual(clientsModule.keyFlags({ revoked: false, createdAt: now - DAY, lastUsedAt: now - 31 * DAY }, now), ["idle 31 days"]);
  assert.deepEqual(clientsModule.keyFlags({ revoked: false, createdAt: now - 200 * DAY, lastUsedAt: now - DAY }, now), ["due for rotation"]);
  assert.deepEqual(clientsModule.keyFlags({ revoked: true, createdAt: now - 400 * DAY }, now), [], "revoked keys need nothing");
});

test("client health: every API-key route logs client errors, and logging never breaks a response", () => {
  const http = read("backend/convex/http.ts");
  for (const route of ["POST /v1/verify/idp", "POST /v1/verify/aml", "GET /v1/verify", "GET /v1/verify/*", "GET /v1/credits", "GET /v1/credits/ledger"]) {
    assert.ok(http.includes(`apiAction("${route}"`), route);
  }
  assert.doesNotMatch(http, /handler: httpAction\(async \(ctx, request\) => \{\s*const authResult = await authenticateAndRateLimit/, "no route bypasses the wrapper");
  const logger = http.slice(http.indexOf("async function logClientError"), http.indexOf("function apiAction"));
  assert.match(logger, /try \{[\s\S]*_logApiError[\s\S]*\} catch/);
  assert.match(http, /return \{ response: rateLimited\(rateLimit\.retryAfterMs\), auth \}/, "rate limits after auth are attributed");
  assert.match(read("backend/convex/crons.ts"), /internal\.backOfficeClients\.purgeApiErrors/);
});

test("client health: reads need an internal role and test calls are left out of usage", () => {
  const source = read("backend/convex/backOfficeClients.ts");
  const query = source.slice(source.indexOf("export const clientHealth"));
  assert.match(query.slice(0, 400), /await requireInternalUser\(ctx\)/);
  assert.match(query, /if \(isSandbox\(row\)\) continue;/);
});
