const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTs(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  });
  const module = { exports: {} };
  cache.set(relative, module.exports);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = path.resolve(path.dirname(path.join(root, relative)), specifier);
    return loadTs(path.relative(root, `${resolved}.ts`), cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const names = loadTs("backend/convex/lib/nameMatching.ts");
const matching = loadTs("backend/convex/lib/amlMatching.ts");
const n = matching.normalizeName;

const entry = (primaryName, aliases = [], countries = []) => ({
  sourceKey: "UN_CONSOLIDATED",
  entityType: "individual",
  primaryName,
  aliases,
  normalizedNames: [primaryName, ...aliases].map(n),
  countries,
  isActive: true,
});
const score = (subject, listed, country = null, aliases = []) => matching.scoreCandidate(subject, "individual", country, entry(listed, aliases));

test("Arabic, Somali and Swahili spellings of the same name are the same name", () => {
  for (const [left, right] of [
    ["MOHAMMED", "MOHAMED"],
    ["MOHAMED", "MAXAMED"],
    ["HUSSEIN", "XUSEEN"],
    ["ABDULLAHI", "CABDULLAAHI"],
    ["YUSUF", "YOUSSEF"],
    ["FATUMA", "FAADUMO"],
    ["JOHN", "YOHANA"],
    ["DAVID", "DAUDI"],
  ]) {
    assert.equal(names.canonicalToken(left), names.canonicalToken(right), `${left} = ${right}`);
  }
  assert.notEqual(names.canonicalToken("ALI"), names.canonicalToken("WALI"));
  assert.equal(score("John Kamau", "John Kimeu"), null, "two vowels apart is a different name");
});

test("respelled sanctioned names are strong matches, with connectors and titles ignored", () => {
  const variant = score("Mohamed Hussein Abdullahi", "Mohammed Xuseen Cabdullaahi", "KE");
  assert.equal(variant.method, "normalized");
  assert.equal(variant.nameScore, matching.VARIANT_MATCH_SCORE);
  assert.equal(matching.isStrongMatch(variant), true);
  const connector = score("Hon. Dr. Ahmed bin Said", "AHMAD SAID");
  assert.equal(connector.method, "normalized");
  assert.equal(score("Osama bin Laden", "Usama bin Ladin").nameScore >= 90, true, "a near spelling of each part");
});

test("sharing a first name, or short similar names, is not a match", () => {
  assert.equal(score("John Kamau", "John Kariuki"), null);
  assert.equal(score("Ali Mohamed", "Wali Muhammad"), null, "ALI is not WALI");
  assert.equal(score("Grace Wanjiru", "Grace Mugabe"), null);
  assert.equal(score("Alice Atieno", "Artur Zhirov", null, ["A. A."]), null, "initials-only aliases don't match");
});

test("a name with one part more or less goes to review, never an automatic reject", () => {
  const partial = score("John Kamau Mwangi", "John Kamau", "KE");
  assert.ok(partial, "found");
  assert.equal(partial.method, "fuzzy");
  assert.ok(partial.nameScore <= names.PARTIAL_MATCH_CAP);
  assert.equal(matching.isStrongMatch(partial), false);
  assert.equal(matching.decide([partial]).verdict, "review");
  assert.equal(score("Ali Mohamed", "Abd al-Rahman Muhammad Mustafa al-Qaduli Ali"), null, "two common names inside a long name");
});

test("the exact and reordered names still behave as before", () => {
  assert.equal(score("Kamau John", "John Kamau").nameScore, matching.TOKEN_ORDER_MATCH_SCORE);
  assert.equal(score("John Kamau", "JOHN KAMAU").method, "exact");
  assert.ok(names.jaroWinkler("MARTHA", "MARHTA") > 0.95);
  assert.equal(names.tokenAlignmentScore(n("J Kamau"), n("John Kamau")), 95);
});
