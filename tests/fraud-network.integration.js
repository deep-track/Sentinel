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

const fn = loadTs("backend/convex/lib/fraudNetwork.ts");

const parts = (name) => fn.namePartsForHash(name);
const signal = (overrides = {}) => ({ kind: "id_number", clientId: "c1", verificationId: "v0", nameParts: parts("John Kamau"), dob: "1990-01-01", outcome: "pass", shared: false, createdAt: 1, ...overrides });
const current = (overrides = {}) => ({ clientId: "c1", verificationId: "v9", nameParts: parts("John Kamau"), dob: "1990-01-01", network: false, ...overrides });

test("identifiers are normalized before fingerprinting", () => {
  assert.equal(fn.normalizeIdentifier("id_number", " 1234-5678 "), "12345678");
  assert.equal(fn.normalizeIdentifier("id_number", "12"), null, "too short to be an identifier");
  assert.equal(fn.normalizeIdentifier("phone", "0712 345 678"), "254712345678");
  assert.equal(fn.normalizeIdentifier("phone", "+254 712 345678"), "254712345678");
  assert.equal(fn.normalizeIdentifier("email", " Jane@Example.COM "), "jane@example.com");
  assert.equal(fn.normalizeIdentifier("email", "not an email"), null);
});

test("names compare by canonical parts, so a respelling or reordering is the same person", () => {
  assert.equal(fn.namePartOverlap(parts("Mohamed Abdi Hassan"), parts("HASSAN Mohammed Abdi")), 1);
  assert.equal(fn.namePartOverlap(parts("John Kamau"), parts("John Kamau Njoroge")), 1);
  assert.equal(fn.namePartOverlap(parts("John Kamau"), parts("Peter Otieno")), 0);
  assert.equal(fn.namePartOverlap([], parts("Peter Otieno")), 1, "an unknown name isn't a different name");
});

test("an ID number with a different name or date of birth is a strong signal", () => {
  const findings = fn.findingsFor("id_number", current(), [signal({ nameParts: parts("Peter Otieno"), dob: "1985-05-05" })]);
  assert.deepEqual(findings.map((finding) => finding.signal), ["different_name", "different_date_of_birth"]);
  assert.ok(findings.every((finding) => finding.severity === "high" && finding.scope === "your checks"));
  assert.match(findings[0].message, /This ID number was used with a different name in your checks\./);
  assert.ok(fn.needsReview(findings));
  assert.deepEqual(fn.findingsFor("id_number", current(), [signal()]), [], "the same person again is not a signal");
  assert.deepEqual(fn.findingsFor("id_number", current(), [signal({ verificationId: "v9", nameParts: parts("Peter Otieno") })]), [], "the check's own signals don't count");
});

test("phones and emails shared by family are weak until many people use them", () => {
  const two = fn.findingsFor("phone", current(), [signal({ kind: "phone", nameParts: parts("Mary Wanjiru") })]);
  assert.equal(two[0].signal, "many_identities");
  assert.equal(two[0].severity, "medium");
  assert.equal(fn.needsReview(two), false);
  const many = fn.findingsFor("email", current(), ["Mary Wanjiru", "Ali Hassan", "Grace Akinyi"].map((name, index) => signal({ kind: "email", verificationId: `v${index}`, nameParts: parts(name) })));
  assert.equal(many[0].severity, "high");
  assert.match(many[0].message, /used by 3 other people/);
});

test("a link to a fraud rejection is a strong signal", () => {
  const findings = fn.findingsFor("document_number", current(), [signal({ kind: "document_number", outcome: "fraud" })]);
  assert.deepEqual(findings.map((finding) => finding.signal), ["linked_to_fraud"]);
  assert.match(findings[0].message, /in a check rejected for fraud/);
});

test("other clients are only seen when both joined the network, and never named", () => {
  const theirs = signal({ clientId: "c2", nameParts: parts("Peter Otieno") });
  assert.deepEqual(fn.findingsFor("id_number", current(), [{ ...theirs, shared: true }]), [], "this client didn't join");
  assert.deepEqual(fn.findingsFor("id_number", current({ network: true }), [{ ...theirs, shared: false }]), [], "the other client didn't join");
  const seen = fn.findingsFor("id_number", current({ network: true }), [{ ...theirs, shared: true }]);
  assert.equal(seen[0].scope, "the Sentinel network");
  assert.doesNotMatch(JSON.stringify(seen), /c2|Peter|Otieno/);
});

test("identifiers by check type", () => {
  const kyc = fn.identifiersOf({ type: "idp", input: { idNumber: "12345678", firstName: "John", lastName: "Kamau", dateOfBirth: "1990-01-01" } });
  assert.deepEqual(kyc, { identifiers: [{ kind: "id_number", value: "12345678" }], name: "John Kamau", dob: "1990-01-01" });
  const nationalId = fn.identifiersOf({ type: "document", input: {}, result: { identity: { fields: { documentType: "national_id", documentNumber: "23456789", fullName: "Jane Doe", dateOfBirth: "1992-02-02" } } } });
  assert.deepEqual(nationalId.identifiers, [{ kind: "id_number", value: "23456789" }], "a national ID's number is the ID number");
  const passport = fn.identifiersOf({ type: "document", input: {}, result: { identity: { fields: { documentType: "passport", documentNumber: "AK123456", personalNumber: "23456789" } } } });
  assert.deepEqual(passport.identifiers.map((identifier) => identifier.kind), ["document_number", "id_number"]);
  assert.equal(fn.identifiersOf({ type: "aml", input: { entityType: "entity", subjectName: "Acme Ltd" } }).identifiers.length, 0);
  assert.equal(fn.identifiersOf({ type: "aml", input: { entityType: "individual", subjectName: "John Kamau", idNumber: "12345678", dateOfBirth: "1990" } }).dob, null, "a partial date isn't compared");
});

test("fraud rejections: document fraud flags or the reviewer's reason code", () => {
  assert.equal(fn.isFraudRejection({ flags: [{ code: "edited_with_software" }] }), true);
  assert.equal(fn.isFraudRejection({ flags: [{ code: "document_expired" }] }), false);
  assert.equal(fn.isFraudRejection({}, "Document fraud"), true);
  assert.equal(fn.isFraudRejection({}, "Sanctions match"), false);
});

test("wiring: every check type, review decisions, retention and the setting", () => {
  assert.match(read("backend/convex/documents.ts"), /checkFraudNetwork\(ctx, verification, ruled\.verdict/);
  assert.match(read("backend/convex/verifications.ts"), /row\.type === "idp" && row\.status !== "completed" \? await checkFraudNetwork/);
  assert.match(read("backend/convex/amlPersistence.ts"), /args\.monitoring \? null : await checkFraudNetwork/);
  assert.match(read("backend/convex/kyb.ts"), /await checkFraudNetwork\(ctx, verification, args\.verdict, args\.result\)/);
  assert.match(read("backend/convex/reviewQueue.ts"), /await recordFraudOutcome\(ctx, verification, finalVerdict, client\?\.reasonCode \?\? null\)/);
  assert.match(read("backend/convex/retention.ts"), /"flaggedEntities", "fraudSignals"/);
  const store = read("backend/convex/fraudNetwork.ts");
  assert.match(store, /const escalate = verdict === "pass" && needsReview/, "only a pass is changed, and only to review");
  assert.match(store, /crypto\.subtle\.importKey\("raw", raw, \{ name: "HMAC", hash: "SHA-256" \}/);
  assert.doesNotMatch(read("backend/convex/schema.ts").match(/fraudSignals: defineTable\([\s\S]*?\}\)/)[0], /^\s*(value|idNumber|email|name|fullName|dateOfBirth):/m, "no raw identifiers or names stored");
  assert.match(read("backend/convex/lib/clientSettings.ts"), /shareFraudNetwork: false,/);
  assert.match(read("app/(platform)/settings/screening/screening-settings.tsx"), /label="Join the Sentinel network"/);
});
