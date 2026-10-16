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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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

const own = loadTs("backend/convex/lib/ownership.ts");

const found = (registrationNumber, shareholders) => ({ status: "found", record: { registrationNumber, companyName: registrationNumber, registrationDate: null, active: true, kraPin: null, physicalAddress: null, companyType: null, shareholders } });
const person = (name, shares) => ({ name, shares, idType: "citizen", idNumber: "12345678" });
const company = (name, shares, idNumber) => ({ name, shares, idType: "company", idNumber });

test("shares and holder types are read from BRS records", () => {
  assert.deepEqual(own.parseShares("500 ORDINARY"), { amount: 500, percent: false });
  assert.deepEqual(own.parseShares("1,250 Ordinary shares"), { amount: 1250, percent: false });
  assert.deepEqual(own.parseShares("33.5%"), { amount: 33.5, percent: true });
  assert.equal(own.parseShares("—"), null);
  assert.equal(own.isCompanyHolder(person("Jane Doe", "1")), false);
  assert.equal(own.isCompanyHolder({ name: "Savannah Holdings Limited", idType: null, idNumber: null }), true);
  assert.equal(own.isCompanyHolder({ name: "X", idType: null, idNumber: "PVT-ABC123" }), true);
  assert.equal(own.isCompanyHolder({ name: "Grace Investments", idType: "citizen", idNumber: "1" }), false, "the register's ID type wins");
});

test("ownership is traced through companies; people at 10% or more are beneficial owners", () => {
  const business = found("PVT-ROOT", [person("Grace Achieng", "400 ORDINARY"), company("Savannah Holdings Ltd", "600 ORDINARY", "PVT-HOLD1")]);
  const holdco = found("PVT-HOLD1", [person("Peter Otieno", "50 ORDINARY"), person("John Kamau", "45 ORDINARY"), person("Small Holder", "5 ORDINARY")]);
  const tree = own.buildOwnership(business, new Map([["PVTHOLD1", holdco]]));
  const pct = (name) => tree.nodes.find((node) => node.name === name).effectivePct;
  assert.equal(pct("Grace Achieng"), 40);
  assert.equal(pct("Savannah Holdings Ltd"), 60);
  assert.equal(pct("Peter Otieno"), 30);
  assert.equal(pct("John Kamau"), 27);
  assert.equal(pct("Small Holder"), 3);
  assert.deepEqual(tree.beneficialOwners.map((node) => node.name).sort(), ["Grace Achieng", "John Kamau", "Peter Otieno"]);
  assert.deepEqual(tree.untraced, []);
  assert.equal(tree.nodes.find((node) => node.name === "Peter Otieno").depth, 2);
  assert.deepEqual(tree.nodes.find((node) => node.name === "Peter Otieno").path, ["Savannah Holdings Ltd"]);
  assert.deepEqual(own.undeclaredOwners(tree, ["Grace Achieng", "Peter Otieno"]).map((node) => node.name), ["John Kamau"]);
});

test("companies whose owners can't be found are untraced; circles are caught", () => {
  const business = found("PVT-ROOT", [company("Offshore Holdings Ltd", "70", "FC-999"), company("No Number Ltd", "20", null), person("Jane", "10")]);
  const tree = own.buildOwnership(business, new Map([["FC999", { status: "not_found", message: "x" }]]));
  assert.deepEqual(tree.untraced.map((node) => node.name), ["Offshore Holdings Ltd", "No Number Ltd"]);
  assert.match(tree.nodes[0].note, /foreign/);
  assert.match(tree.nodes[1].note, /No registration number/);
  const circular = own.buildOwnership(found("PVT-A", [company("B Ltd", "100", "PVT-B")]), new Map([["PVTB", found("PVT-B", [company("A Ltd", "100", "PVT-A")])]]));
  assert.match(circular.nodes[1].note, /Circular/);
});

test("lookups go level by level, largest first, within the limits", async () => {
  const records = {
    "PVT-L1A": found("PVT-L1A", [company("Level 2 Ltd", "100", "PVT-L2")]),
    "PVT-L1B": found("PVT-L1B", [person("B Owner", "100")]),
    "PVT-L2": found("PVT-L2", [company("Level 3 Ltd", "100", "PVT-L3")]),
  };
  const asked = [];
  const lookup = async (number) => {
    asked.push(number);
    return records[number] ?? { status: "not_found", message: "x" };
  };
  const business = found("PVT-ROOT", [company("Small Co Ltd", "10", "PVT-L1B"), company("Big Co Ltd", "90", "PVT-L1A")]);
  const traced = await own.traceOwnership(business, lookup);
  assert.deepEqual(asked, ["PVT-L1A", "PVT-L1B", "PVT-L2"], "largest first, then the next level; level 3 isn't looked up");
  const tree = own.buildOwnership(business, traced);
  assert.match(tree.nodes.find((node) => node.name === "Level 3 Ltd").note, /Traced 3 levels/);
  const limited = await own.traceOwnership(business, lookup, { depth: 3, lookups: 1 });
  assert.equal(limited.size, 1 + 1, "the root and one lookup");
});

test("wiring: KYB traces ownership, screens owners and company shareholders, and reviews gaps", () => {
  const node = read("backend/convex/kybNode.ts");
  assert.match(node, /traceOwnership\(lookup, \(number\) => lookUpBrs\(ctx, args\.verificationId, number\)\)/);
  assert.match(node, /beneficial owners \(\$\{UBO_THRESHOLD_PCT\}% or more\) not declared/);
  assert.match(node, /ownership can't be traced through/);
  assert.match(node, /entityType: "entity" as const, country: "KE"/, "company shareholders are screened as organisations");
  assert.match(read("app/(platform)/kyb/[id]/page.tsx"), /Beneficial owner/);
  assert.match(read("components/reports/kyb-report-spec.ts"), /Ownership \(beneficial owners:/);
  assert.equal(own.UBO_THRESHOLD_PCT, 10);
});
