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

// ── Review operations ───────────────────────────────────────────────────────

const reviews = loadWithStubs("backend/convex/backOfficeReviews.ts");
const HOUR = 60 * 60 * 1000;

test("review ops: deadlines by priority", () => {
  const now = 1_800_000_000_000;
  assert.equal(reviews.isOverdue({ priority: "high", createdAt: now - 5 * HOUR }, now), true);
  assert.equal(reviews.isOverdue({ priority: "high", createdAt: now - 3 * HOUR }, now), false);
  assert.equal(reviews.isOverdue({ priority: "normal", createdAt: now - 30 * HOUR, resolvedAt: now - 10 * HOUR }, now), false, "resolved within 24 h");
  assert.equal(reviews.isOverdue({ priority: "low", createdAt: now - 80 * HOUR }, now), true);
});

test("review ops: hold reasons from real production trigger texts", () => {
  const reason = (triggerReason, triggerType = "auto_escalation") => reviews.holdReason({ triggerType, triggerReason });
  assert.equal(reason("Scan service infrastructure failure"), "Service outage");
  assert.equal(reason("Watchlist unavailable or stale (UN Consolidated unavailable) — held for manual review. No match found on OFAC SDN, but screening is incomplete."), "Service outage");
  assert.equal(reason("Liveness not collected; presenter not verified against the document."), "Liveness not collected");
  assert.equal(reason("liveness below threshold or deepfake flagged"), "Liveness or face check");
  assert.equal(reason("document authenticity below threshold or flags present"), "Document authenticity");
  assert.equal(reason("IPRS partial match"), "Identity registry (IPRS)");
  assert.equal(reason("Exact or normalized sanctions-list match requires compliance escalation."), "Sanctions match");
  assert.equal(reason("OpenSanctions politically exposed person (PEP) match requires enhanced due diligence."), "PEP / risk list");
  assert.equal(reason("anything", "client_dispute"), "Client dispute");
});

test("review ops: assignment rules and audit; reviewer names captured on resolve", () => {
  const source = read("backend/convex/backOfficeReviews.ts");
  const assign = source.slice(source.indexOf("export const assignReviewItem"));
  assert.match(assign, /await requireInternalUser\(ctx, "write"\)/, "view-only users can't assign");
  assert.match(assign, /if \(!admin && \(!ownsOrFree \|\| typeof args\.to === "object"\)\)/, "non-admins only take free items or release their own");
  assert.match(assign, /action: "review\.assigned"/);
  const resolve = read("backend/convex/reviewQueue.ts");
  assert.match(resolve, /resolvedByName: params\.reviewerName/);
  assert.match(resolve, /const reviewerName = displayName\(await ctx\.auth\.getUserIdentity\(\)\)/);
});

test("review ops: an OpenSanctions sanctions hit is still a sanctions match", () => {
  const reason = (triggerReason) => reviews.holdReason({ triggerType: "auto_escalation", triggerReason });
  assert.equal(reason("Possible OpenSanctions sanctions match requires human identity resolution."), "Sanctions match");
  assert.equal(reason("Strong OpenSanctions sanctions match requires compliance escalation."), "Sanctions match");
  assert.equal(reason("OpenSanctions risk-list match requires human review."), "PEP / risk list");
});

// ── Risk and compliance ─────────────────────────────────────────────────────

const compliance = loadWithStubs("backend/convex/backOfficeCompliance.ts");

test("risk: fake faces are found in selfie, KYC video and hosted liveness results", () => {
  assert.deepEqual(compliance.fakeFaceCatch({ faceCheck: { prediction: "fake", confidencePct: 97 } }), { source: "selfie", confidencePct: 97 });
  assert.deepEqual(compliance.fakeFaceCatch({ liveness: { deeptrackLive: { prediction: "fake", confidencePct: 92.5 } } }), { source: "video", confidencePct: 92.5 });
  assert.deepEqual(compliance.fakeFaceCatch({ source: "hosted_capture", liveness: { deeptrackLive: { prediction: "fake" } } }), { source: "video", confidencePct: null });
  assert.equal(compliance.fakeFaceCatch({ faceCheck: { prediction: "real", confidencePct: 99 } }), null);
  assert.equal(compliance.fakeFaceCatch({ faceCheck: { error: "upstream_http_error" } }), null);
  assert.equal(compliance.fakeFaceCatch(null), null);
});

test("risk: week bucketing", () => {
  const now = 1_800_000_000_000;
  assert.equal(compliance.weeksAgo(now - DAY, now), 0);
  assert.equal(compliance.weeksAgo(now - 8 * DAY, now), 1);
  assert.equal(compliance.weeksAgo(now - 90 * DAY, now), 12);
});

test("compliance: reads need an internal role; every write needs internal_admin and is audited", () => {
  const source = read("backend/convex/backOfficeCompliance.ts");
  for (const name of ["riskDashboard", "auditLog", "dataRequests"]) {
    const fn = source.slice(source.indexOf(`export const ${name}`));
    assert.match(fn.slice(0, 600), /await requireInternalUser\(ctx\)/, name);
  }
  for (const [name, action] of [["signOffReport", "compliance_report.signed_off"], ["createDataRequest", "data_request.created"], ["updateDataRequest", "data_request.updated"]]) {
    const fn = source.slice(source.indexOf(`export const ${name}`));
    assert.match(fn.slice(0, 500), /await requireInternalAdmin\(ctx, "write"\)/, name);
    assert.ok(fn.includes(`action: "${action}"`), `${name} audited as ${action}`);
  }
});

test("compliance: a report is signed off once, only when completed, with the export hash recorded", () => {
  const source = read("backend/convex/backOfficeCompliance.ts");
  const fn = source.slice(source.indexOf("export const signOffReport"));
  assert.match(fn, /if \(report\.status !== "completed"\)/);
  assert.match(fn, /if \(report\.signedOffAt\) throw/);
  assert.match(fn, /metadata: \{ exportHash: report\.exportHash/);
});

// ── Model and data quality ──────────────────────────────────────────────────

const qualityModule = loadWithStubs("backend/convex/backOfficeQuality.ts");

test("quality: DeepTrack Live checks are read from every result shape", () => {
  assert.deepEqual(qualityModule.liveChecks({ faceCheck: { prediction: "real", confidencePct: 96 } }, {}), [{ kind: "selfie", outcome: "real", confidencePct: 96 }]);
  assert.deepEqual(qualityModule.liveChecks({ faceCheck: { error: "upstream_http_error" } }, {}), [{ kind: "selfie", outcome: "error", confidencePct: null }]);
  assert.deepEqual(
    qualityModule.liveChecks({ liveness: { decision: "review", deeptrackLive: { prediction: "uncertain", confidencePct: 55 } } }, { livenessMediaType: "mp4" }),
    [{ kind: "video", outcome: "uncertain", confidencePct: 55 }],
  );
  assert.deepEqual(qualityModule.liveChecks({ source: "hosted_capture", liveness: { error: "upstream_timeout" } }, {}), [{ kind: "video", outcome: "error", confidencePct: null }]);
});

test("quality: a liveness error on JPEG frames is the internal service's, not DeepTrack Live's", () => {
  assert.deepEqual(qualityModule.liveChecks({ liveness: { error: "upstream_misconfigured" } }, { livenessMediaType: "jpeg_frames" }), []);
  assert.deepEqual(qualityModule.liveChecks({ docScan: { error: "x" }, iprs: { status: "MATCH" } }, {}), []);
  assert.deepEqual(qualityModule.liveChecks(null, null), []);
});

test("back office nav lists every page, and every page exists", () => {
  const nav = read("app/internal-ops/ops-nav.tsx");
  const urls = [...nav.matchAll(/url: "(\/internal-ops\/[a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(urls.length >= 11, `nav has ${urls.length} pages`);
  for (const url of urls) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", "app", ...url.slice(1).split("/"), "page.tsx")), `${url} has a page`);
  }
});
