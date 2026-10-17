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

const memory = loadTs("backend/convex/lib/amlClearedMatches.ts");

test("a customer is remembered only when identified by more than a name", () => {
  assert.equal(memory.subjectKeyFor({ subjectName: "John Kamau", entityType: "individual", country: "KE" }), null, "name and country alone could be anyone");
  const byDob = memory.subjectKeyFor({ subjectName: "John  KAMAU", entityType: "individual", country: "KE", dateOfBirth: "1980-01-02" });
  assert.equal(byDob, memory.subjectKeyFor({ subjectName: "kamau john", entityType: "individual", country: "ke", dateOfBirth: "1980-01-02" }), "same person, name order and case don't matter");
  assert.notEqual(byDob, memory.subjectKeyFor({ subjectName: "John Kamau", entityType: "individual", country: "KE", dateOfBirth: "1990-05-05" }), "another John Kamau");
  assert.match(memory.subjectKeyFor({ subjectName: "John Kamau", entityType: "individual", idNumber: "12 345 678" }), /\|id:12345678\|/);
  assert.equal(memory.subjectKeyFor({ subjectName: "Acme Ltd", entityType: "entity" }), null);
  assert.match(memory.subjectKeyFor({ subjectName: "Acme Ltd", entityType: "entity", registrationNumber: "PVT-1" }), /^entity:/);
  assert.equal(memory.subjectKeyFor({ subjectName: "Anyone", externalRef: " CUST-9 " }), "ref:cust-9", "the client's own customer reference wins");
});

test("a cleared hit stays cleared until it becomes more severe", () => {
  const cleared = { categories: ["pep"], pepClass: 3, riskLevel: "high" };
  assert.equal(memory.stillCleared({ categories: ["pep"], pepClass: 3, riskLevel: "high" }, cleared), true);
  assert.equal(memory.stillCleared({ categories: ["pep"], pepClass: 4, riskLevel: "high" }, cleared), true, "less senior is fine");
  assert.equal(memory.stillCleared({ categories: ["pep"], pepClass: 1, riskLevel: "high" }, cleared), false, "now a more senior PEP");
  assert.equal(memory.stillCleared({ categories: ["pep", "sanctions"], pepClass: 3, riskLevel: "high" }, cleared), false, "now also sanctioned");
  assert.equal(memory.stillCleared({ categories: ["pep"], pepClass: 3, riskLevel: "critical" }, cleared), false, "now critical");
});

test("screening leaves cleared hits out before deciding, and keeps them on the report", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /!isCleared\(candidate\.sourceKey, candidate\.sourceRecordId, candidate\.primaryName,/);
  assert.match(aml, /!isCleared\("OPENSANCTIONS", match\.id, match\.caption,/);
  assert.match(aml, /!isCleared\("ADVERSE_MEDIA", hit\.url, hit\.title,/);
  assert.match(aml, /const ruled = applyScreeningRules\(/);
  assert.match(aml, /cleared: screening\.rememberClearedMatches \? await clearedHitsFor\(ctx, clientId, subjectKey\) : \[\],/);
  assert.match(aml, /suppressed: outcome\.suppressed, subjectKey: subjectKey \?\? undefined/);
  const persistence = read("backend/convex/amlPersistence.ts");
  assert.match(persistence, /suppressedMatches: args\.suppressed/);
  assert.match(persistence, /await noteSuppressed\(ctx, args\.clientId/);
  assert.match(read("backend/convex/amlMonitoring.ts"), /subjectKeys: due\.map\(\(subject\) => subjectKeyFor\(\{ \.\.\.subjectForScreening\(subject\), externalRef: subject\.externalRef \}\)\)/);
  assert.match(read("app/(platform)/aml-check/[id]/aml-report.tsx"), /Previously cleared hits/);
});

test("an approved AML case records its hits as cleared, by their list record id", () => {
  const queue = read("backend/convex/reviewQueue.ts");
  assert.match(queue, /finalVerdict === "pass"\s*\? await recordClearedMatches\(ctx, \{/);
  const cleared = read("backend/convex/amlCleared.ts");
  assert.match(cleared, /if \(verification\.type !== "aml"\) return 0;/);
  assert.match(cleared, /if \(!subjectKey\) return 0;/);
  assert.match(cleared, /const matchKey = hitKey\(hit\.source, hit\.sourceRecordId\);/, "stable across daily list refreshes");
  assert.match(cleared, /requireClientRole\(ctx, row\.clientId, \["client_admin", "reviewer"\]\)/, "forget is for Reviewers and Admins");
  assert.match(cleared, /action: "aml\.cleared_match_forgotten"/);
  assert.equal(loadTs("backend/convex/lib/amlClearedMatches.ts").hitKey("OFAC_SDN", "123"), "OFAC_SDN:123");
});
