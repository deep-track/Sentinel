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

const rr = loadTs("backend/convex/lib/riskRating.ts");
const config = { callForAction: rr.FATF_DEFAULTS.callForAction, increasedMonitoring: rr.FATF_DEFAULTS.increasedMonitoring, reviewMonths: rr.DEFAULT_REVIEW_MONTHS };
const person = (overrides = {}) => ({ entityType: "individual", countries: ["KE"], homeCountry: "KE", hits: [], verdict: "pass", ...overrides });

test("FATF lists as of June 2026, with Kenya on the grey list", () => {
  assert.deepEqual(rr.FATF_DEFAULTS.callForAction, ["KP", "IR", "MM"]);
  assert.equal(rr.FATF_DEFAULTS.increasedMonitoring.length, 22);
  assert.ok(rr.FATF_DEFAULTS.increasedMonitoring.includes("KE"));
  assert.equal(rr.FATF_DEFAULTS.asOf, "2026-06-19");
});

test("geography: home country isn't scored; grey list medium; call-for-action high", () => {
  const domestic = rr.rateCustomer(person(), config);
  assert.equal(domestic.level, "low", "a Kenyan bank's Kenyan customer");
  assert.equal(domestic.score, 10);
  assert.equal(domestic.reviewMonths, 36);
  assert.equal(rr.rateCustomer(person({ homeCountry: "" }), config).level, "medium", "Kenya is grey-listed for a non-Kenyan client");
  const iran = rr.rateCustomer(person({ countries: ["KE", "Iran"] }), config);
  assert.equal(iran.level, "high");
  assert.match(iran.factors[0].detail, /call-for-action jurisdiction: IR/);
  assert.equal(rr.rateCustomer(person({ countries: ["UG"] }), config).score, 15, "a foreign but unlisted country");
});

test("hits: PEPs are always high, a confirmed sanctions match is prohibited, cleared hits don't count", () => {
  const pep = rr.rateCustomer(person({ hits: [{ source: "KE_PEP", categories: ["pep"], pepClass: 3 }], verdict: "review" }), config);
  assert.equal(pep.level, "high");
  assert.equal(pep.reviewMonths, 12);
  const sanctioned = rr.rateCustomer(person({ hits: [{ source: "OFAC_SDN", categories: ["sanctions"], riskLevel: "critical" }], verdict: "reject" }), config);
  assert.equal(sanctioned.level, "prohibited");
  assert.equal(sanctioned.reviewMonths, null);
  const media = rr.rateCustomer(person({ hits: [{ source: "ADVERSE_MEDIA", categories: ["adverse_media"] }, { source: "KE_RISK_LIST", categories: ["fitness_probity"] }], verdict: "review" }), config);
  assert.equal(media.score, 50);
  assert.equal(media.level, "medium");
  assert.equal(rr.rateCustomer(person({ hits: [] }), config).level, "low", "once cleared");
});

test("businesses: industry, channel and ownership", () => {
  const forex = rr.rateCustomer({ entityType: "entity", countries: ["KE"], homeCountry: "KE", hits: [], name: "Savannah Forex Bureau Ltd", remoteOnboarding: true }, config);
  assert.equal(forex.score, 10 + 5 + 20 + 5);
  assert.equal(forex.level, "medium");
  assert.ok(forex.factors.some((factor) => factor.factor === "Industry" && /Money services/.test(factor.detail)));
  const layered = rr.rateCustomer({ entityType: "entity", countries: ["KE"], homeCountry: "KE", hits: [], industry: "real_estate", remoteOnboarding: true, ownership: { untraced: 1, layers: 2, foreignHolders: 1 } }, config);
  assert.equal(layered.level, "high");
  assert.equal(rr.industryFrom("Online betting and gaming"), "gambling");
  assert.equal(rr.industryFrom("Agribusiness"), null);
});

test("helpers: country codes and review dates", () => {
  assert.equal(rr.countryCode("Kenya"), "KE");
  assert.equal(rr.countryCode("KEN"), "KE");
  assert.equal(rr.countryCode("ke"), "KE");
  assert.equal(rr.countryCode("Atlantis"), null);
  assert.equal(new Date(rr.nextReviewAt(Date.UTC(2026, 9, 16), 12)).toISOString().slice(0, 10), "2027-10-16");
  assert.equal(rr.nextReviewAt(1, null), null);
});

test("wiring: rated on every AML screening and KYB, re-rated when cleared, reviews scheduled", () => {
  assert.match(read("backend/convex/amlPersistence.ts"), /await rateAmlScreening\(ctx, args\.verificationId\)/);
  assert.match(read("backend/convex/kyb.ts"), /await rateKyb\(/);
  assert.match(read("backend/convex/reviewQueue.ts"), /rateAmlScreening\(ctx, verification\._id, \{ cleared: true \}\)/);
  assert.match(read("backend/convex/crons.ts"), /riskRatings\.notifyDueReviews/);
  const store = read("backend/convex/riskRatings.ts");
  assert.match(store, /homeCountry: client\?\.billingCurrency === "KES" \? "KE" : ""/);
  assert.match(store, /Math\.min\(subject\.nextReviewAt, due\)/, "a higher rating brings the review forward");
  assert.match(read("backend/convex/lib/clientSettings.ts"), /High-risk customers must be reviewed at least as often as medium-risk ones/);
  assert.match(read("components/app-sidebar.tsx"), /url: "\/customers"/);
});
