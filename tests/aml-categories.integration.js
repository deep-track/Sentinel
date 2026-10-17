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

const categories = loadTs("backend/convex/lib/amlCategories.ts");
const openSanctions = loadTs("backend/convex/lib/openSanctions.ts");

function osResult(overrides = {}) {
  return {
    id: "NK-test",
    caption: "Jane Doe",
    schema: "Person",
    score: 0.95,
    match: true,
    datasets: ["test"],
    properties: { topics: ["sanction"], country: ["ke"] },
    ...overrides,
  };
}
const parse = (results) => openSanctions.parseMatchResponse({ responses: { q: { status: 200, results } } });

// ── Categories ──────────────────────────────────────────────────────────────

test("topics map to the six AML risk categories", () => {
  assert.deepEqual(categories.categoriesFor(["sanction"]), ["sanctions"]);
  assert.deepEqual(categories.categoriesFor(["crime.terror"]), ["sanctions"], "terrorism lists count as sanctions");
  assert.deepEqual(categories.categoriesFor(["role.pep", "gov.national"]), ["pep"]);
  assert.deepEqual(categories.categoriesFor(["role.rca"]), ["pep"]);
  assert.deepEqual(categories.categoriesFor(["wanted"]), ["special_interest"]);
  assert.deepEqual(categories.categoriesFor(["crime.fraud"]), ["special_interest"]);
  assert.deepEqual(categories.categoriesFor(["poi"]), ["special_interest"]);
  assert.deepEqual(categories.categoriesFor(["corp.disqual"]), ["fitness_probity"]);
  assert.deepEqual(categories.categoriesFor(["debarment"]), ["fitness_probity"]);
  assert.deepEqual(categories.categoriesFor(["reg.action", "reg.warn"]), ["fitness_probity"]);
  assert.deepEqual(categories.categoriesFor(["sanction", "role.pep", "crime"]), ["sanctions", "pep", "special_interest"]);
  // Roles and sectors that carry no AML risk on their own.
  for (const topic of ["fin.bank", "corp.public", "role.journo", "gov.soe", "sanction.counter"]) {
    assert.deepEqual(categories.categoriesFor([topic]), [], topic);
  }
});

test("PEP Class 1–4 from position topics; an unstated level is treated as Class 1", () => {
  assert.equal(categories.pepClassFor(["role.pep", "gov.head"]), 1);
  assert.equal(categories.pepClassFor(["role.pep", "gov.national", "gov.legislative"]), 1);
  assert.equal(categories.pepClassFor(["role.pep", "gov.financial"]), 1, "central bank");
  assert.equal(categories.pepClassFor(["role.pep", "gov.state"]), 2, "county / regional government");
  assert.equal(categories.pepClassFor(["role.pep", "role.diplo"]), 2);
  assert.equal(categories.pepClassFor(["role.pep", "mil"]), 2);
  assert.equal(categories.pepClassFor(["role.pep", "gov.soe"]), 3);
  assert.equal(categories.pepClassFor(["role.pep", "gov.igo"]), 3);
  assert.equal(categories.pepClassFor(["role.pep", "gov.muni"]), 3);
  assert.equal(categories.pepClassFor(["role.pep", "pol.party"]), 3);
  assert.equal(categories.pepClassFor(["role.rca"]), 4, "family member / close associate");
  assert.equal(categories.pepClassFor(["role.pep", "gov.state", "gov.national"]), 1, "the most senior position wins");
  assert.equal(categories.pepClassFor(["role.pep"]), 1);
  assert.equal(categories.pepClassFor(["sanction"]), null);
});

test("category summary counts hits and keeps the most severe PEP class", () => {
  const summary = categories.summarizeCategories([
    { categories: ["pep"], pepClass: 3 },
    { categories: ["pep"], pepClass: 2 },
    { categories: ["sanctions", "special_interest"] },
  ]);
  assert.equal(summary.pep.hits, 2);
  assert.equal(summary.pep.highestPepClass, 2);
  assert.equal(summary.sanctions.hits, 1);
  assert.equal(summary.special_interest.hits, 1);
  assert.equal(summary.insolvency.hits, 0);
  assert.equal(summary.adverse_media.hits, 0);
});

test("dates of birth: partial ISO input and tolerant comparison", () => {
  for (const ok of ["1970", "1970-05", "1970-05-17"]) assert.equal(categories.isPartialIsoDate(ok), true, ok);
  for (const bad of ["17/05/1970", "1970-13", "1970-05-32", "70", "1850", ""]) assert.equal(categories.isPartialIsoDate(bad), false, bad);
  const match = categories.birthDateMatch;
  assert.equal(match("1970-05-17", ["1970-05-17"]), "match");
  assert.equal(match("1970", ["1970-05-17"]), "match", "year-only input");
  assert.equal(match("1970-05-17", ["1971"]), "match", "lists often record an approximate year");
  assert.equal(match("1970-05-17", ["1970-06-01"]), "mismatch");
  assert.equal(match("1970-05-17", ["1985-01-01", "1986"]), "mismatch");
  assert.equal(match("1970-05-17", []), "unknown");
  assert.equal(match(undefined, ["1970"]), "unknown");
});

// ── OpenSanctions ───────────────────────────────────────────────────────────

test("match query sends person identifiers, or company registration details", () => {
  const person = openSanctions.buildMatchQuery({
    name: "Jane Doe",
    entityType: "individual",
    country: "KE",
    aliases: ["J. Doe", " "],
    birthDate: "1970-05-17",
    nationality: "KE",
    idNumber: "12345678",
    registrationNumber: "ignored for people",
  }).queries.q;
  assert.equal(person.schema, "Person");
  assert.deepEqual(person.properties, {
    name: ["Jane Doe"],
    country: ["KE"],
    alias: ["J. Doe"],
    birthDate: ["1970-05-17"],
    nationality: ["KE"],
    idNumber: ["12345678"],
  });
  const company = openSanctions.buildMatchQuery({
    name: "Acme Ltd",
    entityType: "entity",
    registrationNumber: "PVT-123",
    jurisdiction: "KE",
    birthDate: "ignored for companies",
  }).queries.q;
  assert.equal(company.schema, "LegalEntity");
  assert.deepEqual(company.properties, { name: ["Acme Ltd"], registrationNumber: ["PVT-123"], jurisdiction: ["KE"] });
});

test("a conflicting date of birth drops PEP and risk-list look-alikes and can't hard-reject a sanctions hit", () => {
  const pep = osResult({ score: 0.92, properties: { topics: ["role.pep", "gov.national"], birthDate: ["1950-01-01"] } });
  const sanction = osResult({ id: "sdn", score: 0.97, properties: { topics: ["sanction"], birthDate: ["1950-01-01"] } });
  const annotate = (results, dob) => openSanctions.annotateBirthDates(parse(results), dob);

  assert.equal(openSanctions.decideOpenSanctions(annotate([pep], "1990-02-02")).verdict, "pass");
  assert.equal(openSanctions.decideOpenSanctions(annotate([pep], "1950")).verdict, "review");
  assert.equal(openSanctions.decideOpenSanctions(annotate([pep], undefined)).verdict, "review", "no DOB given: no change");

  assert.equal(openSanctions.decideOpenSanctions(annotate([sanction], "1990-02-02")).verdict, "review");
  assert.equal(openSanctions.decideOpenSanctions(annotate([sanction], "1950-01-01")).verdict, "reject");
});

test("decision reasons name the category and the PEP class", () => {
  const decide = (topics) => openSanctions.decideOpenSanctions(parse([osResult({ properties: { topics } })]));
  assert.match(decide(["role.pep", "gov.head"]).reason, /PEP Class 1/);
  assert.match(decide(["role.pep", "gov.muni"]).reason, /PEP Class 3/);
  assert.match(decide(["role.rca"]).reason, /PEP Class 4/);
  assert.match(decide(["corp.disqual"]).reason, /fitness and probity/);
  assert.match(decide(["wanted"]).reason, /special interest/);
  assert.equal(decide(["fin.bank"]).verdict, "pass", "a bank is not a risk hit");
  assert.equal(openSanctions.categorize(parse([osResult({ properties: { topics: ["role.oligarch"] } })])[0]), "other");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("subject details are validated, stored and sent to OpenSanctions", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /Date of birth must be YYYY, YYYY-MM or YYYY-MM-DD\./);
  assert.match(aml, /Registration number and jurisdiction apply to companies only\./);
  assert.match(aml, /Nationality and ID number apply to individuals only\./);
  assert.match(aml, /input: \{ subjectName, entityType: args\.entityType, country: country \?\? null, \.\.\.details, \.\.\.\(externalRef \? \{ externalRef \} : \{\}\) \}/);
  assert.match(aml, /birthDate: subject\.dateOfBirth,/);
  assert.match(aml, /annotateBirthDates\(result, batch\[index\]\.dateOfBirth\)/);
  assert.match(aml, /categories: \["sanctions" as const\]/, "OFAC / UN hits are sanctions");
  assert.match(aml, /categories: riskCategories\(match\)/);
  const http = read("backend/convex/http.ts");
  assert.match(http, /\["dateOfBirth", 10\]/);
  assert.match(http, /categories: r\.categories && typeof r\.categories === "object" \? r\.categories : null/);
  assert.match(http, /pepClass: typeof match\.pepClass === "number" \? match\.pepClass : null/);
  const persistence = read("backend/convex/amlPersistence.ts");
  assert.match(persistence, /categories: summarizeCategories\(/);
  assert.match(read("backend/convex/schema.ts"), /pepClass: v\.optional\(v\.union\(v\.literal\(1\), v\.literal\(2\), v\.literal\(3\), v\.literal\(4\)\)\)/);
});
