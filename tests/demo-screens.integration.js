const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const screens = read("backend/convex/demoScreens.ts");
const seed = read("backend/convex/demoSeed.ts");

test("the screenshot data is internal, confirmed by name and only for the demo client", () => {
  assert.match(screens, /export const add = internalAction\(/);
  assert.match(screens, /const confirm = v\.literal\(DEMO_NAME\);/);
  assert.match(screens, /\.find\(\(row\) => row\.isDemo\)/);
  assert.doesNotMatch(screens, /export const \w+ = (mutation|query|action)\(/, "nothing public");
});

test("it never touches the shared screening lists or the real invoice sequence", () => {
  assert.doesNotMatch(screens, /insert\("pepRegister"|insert\("riskListEntries"|riskSettings/);
  assert.match(screens, /const DEMO_INVOICE = "DEMO-2026-0001";/);
  assert.doesNotMatch(screens, /billingSettings|invoiceNext/);
  assert.doesNotMatch(screens, /chargeReason|chargeCredits: true|fetch\(/);
});

test("nothing it adds can be used or sends anything", () => {
  // The API key's secret is salted and discarded, so no presented key matches.
  assert.match(screens, /hashedKey: await sha256Hex\(`\$\{rawKey\}:\$\{randomKeySegment\(16\)\}`\)/);
  assert.match(screens, /const WEBHOOK_URL = "https:\/\/hooks\.demo-bank\.example\/sentinel";/);
  assert.match(screens, /environment: "test",\s*\n\s*status: "active"/);
  // SSO: no Auth0 connection, enforcement off.
  assert.match(screens, /enforce: false,/);
  // The former analyst is not an Auth0 user and is inactive.
  assert.match(screens, /userId: "demo\|faith-wambui"/);
  assert.match(screens, /role: "compliance_analyst", isActive: false/);
  // Liveness requests are rows only; nothing is texted.
  assert.doesNotMatch(screens, /sendInvitation|dispatch/);
});

test("checks go through Sentinel's real completion code", () => {
  assert.match(screens, /internalApi\.amlPersistence\.complete/);
  assert.match(screens, /internalApi\.verifications\._complete/);
  assert.match(screens, /recordClearedMatches\(ctx/);
});

test("reset removes everything it adds", () => {
  const reset = seed.slice(seed.indexOf("export const reset"));
  for (const table of ["invoices", "apiKeys", "webhookDeliveries", "webhookEndpoints", "amlClearedMatches", "retentionPurges", "livenessRequests", "dataRequests"]) {
    assert.ok(reset.includes(`query("${table}")`), table);
  }
  assert.match(reset, /ctx\.storage\.delete\(row\.profile\.logoStorageId\)/);
  assert.match(reset, /row\.userId\.startsWith\("demo\|"\)/);
});
