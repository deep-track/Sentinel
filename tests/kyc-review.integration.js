const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Manual review is resolved by internal reviewers only (reviewQueue.resolve).
// The client-facing review page is a read-only status view.
test("KYC review page is a read-only status view", () => {
  const reviewPage = read("app/(platform)/kyc/[id]/review/page.tsx");
  const detailPage = read("app/(platform)/kyc/[id]/page.tsx");
  const verification = read("backend/convex/verifications.ts");

  assert.match(verification, /export const get = query/);
  assert.match(reviewPage, /anyApi\.verifications\.get/);
  assert.match(reviewPage, /anyApi\.reviewQueue\.listForClient/);
  // No decision controls on the client side.
  assert.doesNotMatch(reviewPage, /KYCReviewActions|kyc-review-actions/);
  assert.doesNotMatch(reviewPage, /verifications\.review\b/);
  assert.doesNotMatch(reviewPage, /reviewQueue\.resolve\b/);
  assert.doesNotMatch(reviewPage, /useMutation/);
  assert.match(detailPage, /anyApi\.verifications\.get/);
  assert.match(detailPage, /record\.type !== "idp"/);
});

test("review resolution is restricted to internal reviewers", () => {
  const reviewQueue = read("backend/convex/reviewQueue.ts");
  const resolve = reviewQueue.slice(reviewQueue.indexOf("export const resolve = mutation"));
  assert.ok(resolve.length > 0, "reviewQueue.resolve exists");
  assert.match(resolve, /requireInternalUser\(ctx\)/);
  assert.match(reviewQueue, /export const listForClient = query/);
  assert.match(reviewQueue, /requireClientRole\(ctx/);
});

test("new admin backend contracts are present and authorization-bound", () => {
  const aml = read("backend/convex/aml.ts");
  const liveness = read("backend/convex/liveness.ts");
  const apiKeys = read("backend/convex/apiKeys.ts");
  const memberships = read("backend/convex/memberships.ts");
  assert.match(aml, /export const submit = mutation/);
  assert.match(aml, /requireClientRole\(ctx/);
  assert.match(aml, /runScreening/);
  assert.match(liveness, /export const submit = mutation/);
  assert.match(liveness, /export const status = query/);
  assert.match(liveness, /requireClientRole\(ctx/);
  assert.match(apiKeys, /export const listForClient = query/);
  assert.match(apiKeys, /export const revoke = mutation/);
  assert.match(apiKeys, /requireClientRole\(ctx/);
  assert.match(memberships, /export const listForClient = query/);
  assert.match(memberships, /export const upsert = mutation/);
});

test("AML and liveness submissions check credits before creating work", () => {
  const aml = read("backend/convex/aml.ts");
  const liveness = read("backend/convex/liveness.ts");
  for (const source of [aml, liveness]) {
    const submit = source.slice(source.indexOf("export const submit = mutation"));
    const creditCheck = submit.search(/assertCredits\w*\(ctx/);
    const insert = submit.indexOf('ctx.db.insert("verifications"');
    assert.ok(creditCheck > 0, "submit checks the credit balance");
    assert.ok(insert > creditCheck, "credit check happens before the verification is created");
  }
});
