const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative) {
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, require, module);
  return module.exports;
}

const pricing = loadTs("backend/convex/lib/pricing.ts");
const PAID = ["starter", "growth", "business", "enterprise"];

test("USD prices match the DeepTrack Sentinel price list (in cents)", () => {
  const expected = {
    identity_document: [80, 50, 45, 30],
    liveness: [50, 25, 18, 15],
    aml: [60, 50, 40, 35],
    proof_of_address: [110, 80, 70, 65],
    kyb: [200, 150, 95, 90],
    kyc_identity: [130, 75, 63, 45],
  };
  for (const [service, prices] of Object.entries(expected)) {
    assert.deepEqual(PAID.map((plan) => pricing.PRICES.USD[plan][service]), prices, service);
  }
  // KYC = document verification + liveness on every plan.
  for (const plan of PAID) {
    assert.equal(pricing.PRICES.USD[plan].kyc_identity, pricing.PRICES.USD[plan].identity_document + pricing.PRICES.USD[plan].liveness);
  }
  assert.deepEqual(PAID.map((plan) => pricing.PLAN_PREPAY.USD[plan]), [2_500, 5_500, 12_000, 17_000]);
  assert.deepEqual(PAID.map((plan) => pricing.planCredits(plan, "USD")), [250_000, 550_000, 1_200_000, 1_700_000]);
});

test("KES: 1 credit = KES 40 = one KYC, plans 250k/550k/1.2M/1.7M with bonus credits", () => {
  assert.equal(pricing.CREDIT_VALUE.KES, 40);
  assert.deepEqual(PAID.map((plan) => pricing.PLAN_PREPAY.KES[plan]), [250_000, 550_000, 1_200_000, 1_700_000]);
  assert.deepEqual(PAID.map((plan) => pricing.planCredits(plan, "KES")), [6_250, 15_125, 34_500, 51_000]);
  for (const plan of PAID) {
    assert.equal(pricing.priceCredits(plan, "KES", "idp"), 1, `KYC is 1 credit on ${plan}`);
    assert.equal(pricing.priceCredits(plan, "KES", "document", "proof_of_address"), 2);
    assert.equal(pricing.priceCredits(plan, "KES", "kyb"), 5);
  }
});

test("bigger plans pay less per check, and KES KYC never drops below the KES 30–50 market rate", () => {
  const kyc = PAID.map((plan) => pricing.creditsToMoney(pricing.priceCredits(plan, "KES", "idp"), "KES", plan));
  assert.deepEqual(kyc, [40, 36.36, 34.78, 33.33]);
  for (const price of kyc) assert.ok(price >= 30 && price <= 50, `KES ${price}`);
  for (const currency of ["USD", "KES"]) {
    for (const type of ["idp", "aml", "liveness", "kyb"]) {
      const perPlan = PAID.map((plan) => pricing.creditsToMoney(pricing.priceCredits(plan, currency, type), currency, plan));
      for (let index = 1; index < perPlan.length; index++) {
        assert.ok(perPlan[index] <= perPlan[index - 1], `${currency} ${type} gets cheaper: ${perPlan.join(", ")}`);
      }
    }
  }
});

test("each check type maps to the right service; trial uses Starter prices", () => {
  assert.equal(pricing.serviceFor("idp"), "kyc_identity");
  assert.equal(pricing.serviceFor("document", "identity"), "identity_document");
  assert.equal(pricing.serviceFor("document", "proof_of_address"), "proof_of_address");
  assert.equal(pricing.serviceFor("aml"), "aml");
  assert.equal(pricing.serviceFor("liveness"), "liveness");
  assert.equal(pricing.serviceFor("kyb"), "kyb");
  assert.equal(pricing.priceCredits("trial", "USD", "aml"), 60);
  assert.equal(pricing.priceCredits("trial", "KES", "idp"), 1);
});

test("money conversions: credits ↔ money per currency and plan, combined USD only with a rate", () => {
  assert.equal(pricing.creditsToMoney(250_000, "USD", "starter"), 2_500);
  assert.equal(pricing.creditsToMoney(51_000, "KES", "enterprise"), 1_700_000);
  assert.equal(pricing.moneyToCredits(10_000, "KES", "growth"), 275, "KES 10,000 buys 250 credits + 10%");
  assert.equal(pricing.toUsd(129_000, "KES", 129), 1_000);
  assert.equal(pricing.toUsd(129_000, "KES", null), null);
  assert.equal(pricing.toUsd(50, "USD", null), 50);
  assert.equal(pricing.priceList("growth", "KES").find((row) => row.service === "kyc_identity").amount, 36.36);
});

test("wiring: every check is priced from the client's plan and currency at creation", () => {
  const types = read("backend/convex/lib/verificationTypes.ts");
  assert.match(types, /priceCredits\(client\?\.plan \?\? "starter", client\?\.billingCurrency \?\? "USD", type, documentKind\)/);
  for (const [file, call] of [
    ["backend/convex/aml.ts", 'creditsForVerification(ctx, args.clientId, "aml")'],
    ["backend/convex/kyb.ts", 'creditsForVerification(ctx, args.clientId, "kyb")'],
    ["backend/convex/liveness.ts", 'creditsForVerification(ctx, args.clientId, "liveness")'],
    ["backend/convex/verifications.ts", 'creditsForVerification(ctx, params.clientId, "idp")'],
  ]) {
    assert.ok(read(file).includes(call), `${file} uses ${call}`);
  }
  assert.doesNotMatch(read("backend/convex/lib/verificationTypes.ts"), /creditsForType/);
  const admin = read("backend/convex/admin.ts");
  assert.match(admin, /The billing currency can only change while the balance is zero/);
  assert.match(read("backend/convex/schema.ts"), /billingCurrency: v\.optional\(v\.union\(v\.literal\("USD"\), v\.literal\("KES"\)\)\)/);
  assert.match(read("backend/convex/http.ts"), /internal\.creditLedger\._getCreditSummary/);
});

test("client billing page: per-organization history query, role-gated, with money values", () => {
  const ledger = read("backend/convex/creditLedger.ts");
  const fn = ledger.slice(ledger.indexOf("export const billingForClient"));
  assert.match(fn.slice(0, 400), /await requireClientRole\(ctx, args\.clientId, \[\.\.\.HISTORY_ROLES\]\)/);
  assert.match(fn, /withIndex\("by_client_created_at"/);
  assert.match(fn, /value: row\.value \?\? null,/);
  const page = read("app/(platform)/billing/page.tsx");
  assert.match(page, /requireActiveScope\(\)/, "one organization at a time, not summed across currencies");
  assert.doesNotMatch(page, /Transaction history isn&apos;t available yet/);
  assert.match(read("app/(platform)/billing/billing-view.tsx"), /anyApi\.creditLedger\.billingForClient/);
});

test("ledger rows record their money value when written; history never reprices", () => {
  const credits = read("backend/convex/lib/credits.ts");
  assert.match(credits, /value: creditsToMoney\(entry\.amount, currency, client\?\.plan \?\? "starter"\)/);
  assert.match(read("backend/convex/schema.ts"), /currency: v\.optional\(v\.union\(v\.literal\("USD"\), v\.literal\("KES"\)\)\),\s*value: v\.optional\(v\.number\(\)\),/);
  assert.match(read("backend/convex/creditLedger.ts"), /value: row\.value \?\? null,/);
  const billing = read("backend/convex/backOfficeBilling.ts");
  assert.match(billing, /revenueByMonth\[index\] -= row\.value;/);
  assert.match(billing, /lines: lines\.map\(\(line, index\) => \(\{ \.\.\.line, value: rows\[index\]\.value \?\? null \}\)\)/);
  assert.match(read("app/(platform)/billing/billing-view.tsx"), /Recorded before currency pricing/);
});
