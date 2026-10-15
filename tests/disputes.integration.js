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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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

const disputes = loadTs("backend/convex/lib/disputes.ts");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 15);
const finished = (overrides = {}) => ({ status: "completed", verdict: "reject", completedAt: now - DAY, updatedAt: now - DAY, createdAt: now - 2 * DAY, ...overrides });

test("only a finished pass or rejection, within 90 days, without an open case, can be disputed", () => {
  assert.equal(disputes.disputeBlocker({ verification: finished(), reviews: [], now }), null);
  assert.equal(disputes.disputeBlocker({ verification: finished({ verdict: "pass" }), reviews: [], now }), null);
  assert.match(disputes.disputeBlocker({ verification: finished({ status: "processing" }), reviews: [], now }), /finished/);
  assert.match(disputes.disputeBlocker({ verification: finished({ verdict: "review" }), reviews: [], now }), /Reviews/);
  assert.match(disputes.disputeBlocker({ verification: finished({ completedAt: now - 91 * DAY }), reviews: [], now }), /90 days/);
  assert.match(disputes.disputeBlocker({ verification: finished(), reviews: [{ status: "pending", triggerType: "client_dispute" }], now }), /already disputed/);
  assert.match(disputes.disputeBlocker({ verification: finished(), reviews: [{ status: "in_review", triggerType: "auto_escalation" }], now }), /open review/);
  assert.equal(disputes.disputeBlocker({ verification: finished(), reviews: [{ status: "resolved", triggerType: "client_dispute" }], now }), null, "a closed dispute doesn't block a new one");
});

test("a dispute needs a reason of 10 to 2000 characters", () => {
  assert.deepEqual(disputes.cleanDisputeReason("  too short "), { error: "Explain the dispute in at least 10 characters." });
  assert.equal(disputes.cleanDisputeReason("  The ID was verified in branch.  "), "The ID was verified in branch.");
  assert.ok(disputes.cleanDisputeReason("x".repeat(2001)).error);
});

test("wiring: opening, withdrawing and listing disputes", () => {
  const source = read("backend/convex/disputes.ts");
  assert.match(source, /triggerType: "client_dispute"/);
  assert.match(source, /priority: "high"/);
  assert.match(source, /disputeReason: reason, disputedAt: now/);
  assert.match(source, /disputedVerdict: verification\.verdict === "pass" \? "pass" : "reject", expectedVerdict: args\.expectedVerdict/);
  assert.match(source, /action: "verification\.disputed"/);
  assert.match(source, /withdrawnAt: now, withdrawnBy: actor\.userId/);
  assert.match(source, /MAX_OPEN_DISPUTES/);
  assert.match(source, /const DISPUTE_ROLES: ClientRole\[\] = \["client_admin", "reviewer", "compliance_analyst"\]/);
});

test("DeepTrack decides disputes: client teams can't, and aren't assigned or alerted", () => {
  const reviews = read("backend/convex/clientReviews.ts");
  assert.match(reviews, /if \(row\.triggerType === "client_dispute"\) forbidden\("DeepTrack decides disputes/);
  assert.match(reviews, /!dispute && settings\.review\.assignment === "round_robin"/);
  assert.match(reviews, /if \(dispute\) \{\s*\/\/ No alert/);
  const queue = read("backend/convex/reviewQueue.ts");
  assert.match(queue, /reviewRow\.triggerType === "client_dispute"[\s\S]{0,200}event: "dispute_resolved"/);
  const settings = read("backend/convex/lib/clientSettings.ts");
  assert.match(settings, /"dispute_resolved",\r?\n\] as const/);
  assert.match(settings, /dispute_resolved: \{ enabled: true, email: true/);
  const item = read("app/internal-ops/review-queue/[reviewId]/review-item.tsx");
  assert.match(item, /item\.triggerType === "client_dispute" \? DISPUTE_ACTIONS : ACTIONS/);
});

test("the dispute button is on every result page", () => {
  for (const page of ["kyc/[id]/page.tsx", "kyb/[id]/page.tsx", "kyi/[id]/page.tsx", "aml-check/[id]/page.tsx", "idp/[id]/page.tsx"]) {
    assert.match(read(`app/(platform)/${page}`), /<DisputeButton verificationId=\{id\} \/>/, page);
  }
  assert.match(read("components/app-sidebar.tsx"), /url: "\/disputes"/);
});
