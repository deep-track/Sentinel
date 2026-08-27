const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("KYC review workflow is wired end to end", () => {
  const verification = read("backend/convex/verifications.ts");
  const reviewPage = read("app/(platform)/kyc/[id]/review/page.tsx");
  const actions = read("app/(platform)/kyc/[id]/review/kyc-review-actions.tsx");
  const detailPage = read("app/(platform)/kyc/[id]/page.tsx");

  assert.match(verification, /export const get = query/);
  assert.match(verification, /export const review = mutation/);
  assert.match(verification, /requireInternalUser\(ctx\)/);
  assert.match(verification, /accessibleClientIds\(ctx\)/);
  assert.match(reviewPage, /anyApi\.verifications\.get/);
  assert.match(reviewPage, /KYCReviewActions/);
  assert.match(actions, /anyApi\.verifications\.review/);
  assert.match(actions, /verdict/);
  assert.match(detailPage, /anyApi\.verifications\.get/);
  assert.match(detailPage, /record\.type !== "idp"/);
});

test("KYC review decisions expose the three supported outcomes", () => {
  const actions = read("app/(platform)/kyc/[id]/review/kyc-review-actions.tsx");
  for (const verdict of ["pass", "review", "reject"]) {
    assert.match(actions, new RegExp(`submit\\(\\"${verdict}\\"\\)`));
  }
});
