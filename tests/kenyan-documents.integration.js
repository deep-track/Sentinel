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

const dc = loadTs("backend/convex/lib/documentChecks.ts");
const kyb = loadTs("backend/convex/lib/kybChecks.ts");
const NOW = Date.UTC(2026, 9, 16);

// A TD1 zone with valid check digits.
function td1({ documentNumber, optional = "", birth = "900101", sex = "M", expiry = "<<<<<<", country = "KYA", nationality = "KEN", name = "KAMAU<<JOHN" }) {
  const pad = (value, length) => (value + "<".repeat(length)).slice(0, length);
  const number = pad(documentNumber, 9);
  const opt1 = pad(optional, 15);
  const expiryDigit = /^\d{6}$/.test(expiry) ? String(dc.mrzCheckDigit(expiry)) : "<";
  const one = `ID${country}${number}${dc.mrzCheckDigit(number)}${opt1}`;
  const twoStart = `${birth}${dc.mrzCheckDigit(birth)}${sex}${expiry}${expiryDigit}${nationality}`;
  const opt2 = pad("", 11);
  const composite = one.slice(5, 30) + twoStart.slice(0, 7) + twoStart.slice(8, 15) + opt2;
  const two = `${twoStart}${opt2}${dc.mrzCheckDigit(composite)}`;
  return [one, two, pad(name, 30)];
}

const kenyanId = (overrides = {}) => ({
  documentType: "national_id",
  issuingCountry: "KEN",
  documentNumber: "12345678",
  surname: "KAMAU",
  givenNames: "JOHN",
  fullName: "JOHN KAMAU",
  dateOfBirth: "1990-01-01",
  sex: "M",
  nationality: "KEN",
  placeOfBirth: "NYERI",
  issueDate: "2010-05-05",
  expiryDate: null,
  issuingAuthority: null,
  address: null,
  personalNumber: null,
  serialNumber: "200123456",
  kenyanIdType: "second_generation",
  mrzLines: [],
  hasFacePhoto: true,
  hasSignature: true,
  ...overrides,
});

const codes = (flags) => flags.map((flag) => flag.code);

test("a genuine second-generation Kenyan ID passes: no expiry, serial number in the MRZ", () => {
  const mrzLines = td1({ documentNumber: "200123456", optional: "12345678" });
  const rules = dc.identityRuleChecks(kenyanId({ mrzLines }), NOW);
  assert.ok(rules.mrz, "the zone parses");
  assert.equal(rules.mrz.optionalData, "12345678");
  assert.deepEqual(codes(rules.flags), [], "no missing-expiry or MRZ-mismatch flag");
  assert.equal(dc.documentVerdict(rules.flags).verdict, "pass");
});

test("Kenyan ID rules still catch real problems", () => {
  const wrongNumber = dc.identityRuleChecks(kenyanId({ mrzLines: td1({ documentNumber: "299999999", optional: "87654321" }) }), NOW);
  assert.ok(codes(wrongNumber.flags).includes("mrz_mismatch"), "neither the ID nor the serial number is in the zone");
  assert.ok(codes(dc.identityRuleChecks(kenyanId({ documentNumber: "AB12-XYZ" }), NOW).flags).includes("kenya_id_number_format"));
  const maisha = dc.identityRuleChecks(kenyanId({ kenyanIdType: "maisha_card", serialNumber: null, expiryDate: null }), NOW);
  assert.ok(codes(maisha.flags).includes("missing_expiry"), "Maisha cards do expire");
  const passport = dc.identityRuleChecks(kenyanId({ documentType: "passport", kenyanIdType: null, serialNumber: null }), NOW);
  assert.ok(codes(passport.flags).includes("missing_expiry"), "other documents are unchanged");
});

test("other countries' MRZ document numbers must still match exactly", () => {
  const mrzLines = td1({ documentNumber: "X1234567", country: "UGA", nationality: "UGA", expiry: "300101" });
  const rules = dc.identityRuleChecks(kenyanId({ issuingCountry: "UGA", nationality: "UGA", kenyanIdType: null, serialNumber: null, documentNumber: "X1234568", expiryDate: "2030-01-01", mrzLines }), NOW);
  assert.ok(codes(rules.flags).includes("mrz_mismatch"));
});

test("KRA PIN certificates: format, taxpayer type, declared PIN and name", () => {
  const fields = (overrides = {}) => ({ pin: "A012345678Z", taxpayerName: "JOHN KAMAU", taxpayerType: "individual", email: "j@example.com", certificateDate: "2024-03-01", obligations: ["Income Tax - Resident Individual"], issuedByKra: true, ...overrides });
  const clean = dc.kraPinChecks(fields(), { name: "John Kamau", kraPin: "a012345678z" }, NOW);
  assert.deepEqual(codes(clean.flags), []);
  assert.equal(dc.documentVerdict(clean.flags).verdict, "pass");
  assert.ok(codes(dc.kraPinChecks(fields({ pin: "B12345" }), {}, NOW).flags).includes("kra_pin_format"));
  assert.equal(dc.documentVerdict(dc.kraPinChecks(fields({ pin: "B12345" }), {}, NOW).flags).verdict, "reject");
  assert.ok(codes(dc.kraPinChecks(fields({ pin: "P051234567Q" }), {}, NOW).flags).includes("kra_pin_type_mismatch"), "a P PIN on an individual's certificate");
  assert.ok(codes(dc.kraPinChecks(fields(), { kraPin: "A099999999B" }, NOW).flags).includes("expected_kra_pin_mismatch"));
  assert.ok(codes(dc.kraPinChecks(fields(), { name: "Mary Wanjiru" }, NOW).flags).includes("expected_name_mismatch"));
  assert.ok(codes(dc.kraPinChecks(fields({ issuedByKra: false }), {}, NOW).flags).includes("not_a_kra_certificate"));
  assert.equal(dc.KRA_PIN_PATTERN.test("A012345678Z"), true);
});

test("CR12: must be recent, and its shareholders must be on the BRS register", () => {
  const cr12 = (overrides = {}) => ({ documentType: "cr12", companyName: "Acme Kenya Limited", registrationNumber: "PVT-ABC123", incorporationDate: "2015-01-01", jurisdiction: "KEN", issuingAuthority: "Business Registration Service", directors: ["John Kamau"], documentDate: "2026-09-30", shareholders: [{ name: "John Kamau", shares: "500" }, { name: "Mary Wanjiru", shares: "500" }], ...overrides });
  const declared = { businessName: "ACME (KENYA) LTD", registrationNumber: "PVT-ABC123", directors: ["John Kamau"] };
  assert.deepEqual(codes(kyb.certificateRules(cr12(), declared, NOW).flags), []);
  assert.ok(codes(kyb.certificateRules(cr12({ documentDate: "2026-01-10" }), declared, NOW).flags).includes("cr12_out_of_date"));
  assert.ok(codes(kyb.certificateRules(cr12({ documentDate: null }), declared, NOW).flags).includes("cr12_date_unreadable"));
  assert.ok(codes(kyb.certificateRules(cr12({ documentDate: "2027-01-01" }), declared, NOW).flags).includes("cr12_date_in_future"));
  assert.deepEqual(codes(kyb.certificateRules(cr12({ documentType: "certificate_of_incorporation", documentDate: null }), declared, NOW).flags), [], "only a CR12 needs to be recent");

  assert.deepEqual(kyb.cr12AgainstRegistry(cr12(), ["JOHN KAMAU", "MARY WANJIRU"]).flags, []);
  const forged = kyb.cr12AgainstRegistry(cr12(), ["JOHN KAMAU", "PETER OTIENO"]);
  assert.deepEqual(codes(forged.flags), ["cr12_shareholder_not_on_register", "cr12_missing_shareholder"]);
  assert.equal(forged.flags[0].severity, "high");
  assert.deepEqual(kyb.cr12AgainstRegistry(cr12({ documentType: "certificate_of_incorporation" }), ["PETER OTIENO"]).checks, []);
});

test("wiring: the API, form, pipeline and KYB accept the new documents", () => {
  assert.match(read("backend/convex/documents.ts"), /v\.literal\("kra_pin"\)/);
  assert.match(read("backend/convex/http.ts"), /documentKind: \["identity", "proof_of_address", "kra_pin"\]/);
  assert.match(read("backend/convex/lib/documentPipeline.ts"), /readKraPinCertificate\(deps\.client, images\)/);
  assert.match(read("backend/convex/lib/documentVision.ts"), /The Maisha card \(issued from 2023\)/);
  assert.match(read("app/(platform)/idp/document-form.tsx"), /\["kra_pin", "KRA PIN certificate"/);
  assert.match(read("backend/convex/kybNode.ts"), /cr12AgainstRegistry\(certificateDetail\.fields as BusinessRegistrationFields/);
});
