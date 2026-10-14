const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const kyb = loadTs("backend/convex/lib/kybChecks.ts");

const fields = (overrides = {}) => ({
  documentType: "certificate_of_incorporation",
  companyName: "ACME (KENYA) LTD.",
  registrationNumber: "PVT-AB12CD3",
  incorporationDate: "2019-03-04",
  jurisdiction: "KEN",
  issuingAuthority: "Registrar of Companies",
  directors: [],
  ...overrides,
});
const declared = { businessName: "Acme Kenya Limited", registrationNumber: "pvt ab12cd3", directors: ["Jane Wanjiru"] };

test("the certificate must match the declared business", () => {
  const ok = kyb.certificateRules(fields(), declared);
  assert.deepEqual(ok.flags, [], "LTD = Limited, punctuation and case don't matter");
  assert.equal(ok.checks.find((check) => check.name === "Registration number matches").status, "passed");

  const other = kyb.certificateRules(fields({ companyName: "Zenith Holdings Limited", registrationNumber: "PVT-ZZ99" }), declared);
  assert.deepEqual(other.flags.map((flag) => flag.code), ["business_name_mismatch", "registration_number_mismatch"]);

  const future = kyb.certificateRules(fields({ incorporationDate: "2999-01-01" }), declared);
  assert.equal(future.flags.find((flag) => flag.code === "incorporation_date_in_future").severity, "critical");

  const unreadable = kyb.certificateRules(fields({ companyName: null, registrationNumber: null }), declared);
  assert.deepEqual(unreadable.flags.map((flag) => flag.severity), ["medium", "medium"]);
});

test("a CR12 must list the declared directors", () => {
  const listed = kyb.certificateRules(fields({ documentType: "cr12", directors: ["WANJIRU Jane", "Peter Otieno"] }), declared);
  assert.equal(listed.flags.length, 0);
  const missing = kyb.certificateRules(fields({ documentType: "cr12", directors: ["Peter Otieno"] }), declared);
  assert.equal(missing.flags[0].code, "director_not_on_document");
});

test("the KYB verdict: any rejection rejects, anything unclear goes to review, only all-clear passes", () => {
  const clean = { verdict: "pass", reason: "ok" };
  const party = (overrides = {}) => ({ name: "Jane Wanjiru", role: "director", verdict: "pass", complete: true, reason: "No match", ...overrides });
  const business = party({ name: "Acme", role: "business" });
  assert.equal(kyb.decideKyb({ certificate: clean, proofOfAddress: clean, parties: [business, party()] }).verdict, "pass");

  const hit = kyb.decideKyb({ certificate: clean, proofOfAddress: clean, parties: [business, party({ verdict: "review", reason: "PEP Class 2 hit" })] });
  assert.equal(hit.verdict, "review");
  assert.match(hit.reason, /Jane Wanjiru \(director, AML\): PEP Class 2 hit/);

  const sanctioned = kyb.decideKyb({ certificate: { verdict: "review", reason: "name mismatch" }, proofOfAddress: clean, parties: [business, party({ verdict: "reject", reason: "OFAC SDN" })] });
  assert.equal(sanctioned.verdict, "reject", "a rejection outranks review");

  const outage = kyb.decideKyb({ certificate: { verdict: "unavailable", reason: "x" }, proofOfAddress: clean, parties: [business, party({ complete: false })] });
  assert.equal(outage.verdict, "review");
  assert.equal(outage.complete, false, "not charged when the checks couldn't run");
  assert.match(outage.reason, /couldn't be checked automatically/);
});

test("only Sentinel's upload service is fetched", () => {
  assert.equal(kyb.isAllowedDocumentUrl("https://utfs.io/f/abc.pdf"), true);
  assert.equal(kyb.isAllowedDocumentUrl("https://x7y8.ufs.sh/f/abc.pdf"), true);
  assert.equal(kyb.isAllowedDocumentUrl("http://utfs.io/f/abc.pdf"), false, "https only");
  assert.equal(kyb.isAllowedDocumentUrl("https://evil.example/utfs.io"), false);
  assert.equal(kyb.isAllowedDocumentUrl("https://169.254.169.254/latest"), false);
  assert.equal(kyb.normalizeRegistrationNumber(" pvt-ab 12/cd3 "), "PVTAB12CD3");
});

test("wiring: KYB runs the automated checks and stores categorised hits", () => {
  const kybSource = read("backend/convex/kyb.ts");
  assert.match(kybSource, /ctx\.scheduler\.runAfter\(0, internalApi\.kybNode\.processKyb, args\)/);
  assert.match(kybSource, /return await screenSubjects\(ctx, subjects, rules\);/);
  assert.match(kybSource, /await ctx\.db\.insert\("flaggedEntities", \{/, "hits feed the review case category");
  assert.match(kybSource, /if \(args\.complete\) \{\s*await chargeVerification/);
  const node = read("backend/convex/kybNode.ts");
  assert.match(node, /^"use node";/);
  assert.match(node, /if \(!isAllowedDocumentUrl\(url\)\) return/);
  assert.match(node, /documentKind: "proof_of_address", front: poaFile\.bytes, expected: \{ name: input\.businessName \}/);
  assert.match(node, /await manual\("Business verification needs a person: the automatic checks couldn't finish\."\)/);
  assert.match(read("backend/convex/documentsNode.ts"), /export function textractOcr\(\): OcrProvider \| null \{/);
});
