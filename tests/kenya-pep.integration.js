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

const pep = loadTs("backend/convex/lib/kenyaPep.ts");

const entry = (overrides = {}) => ({
  _id: "p1",
  fullName: "Abdullahi Mohamed Hussein",
  aliases: [],
  position: "County Executive Committee Member for Finance",
  organisation: "County Government of Garissa",
  level: "county_government",
  county: "Garissa",
  startDate: "2022-10-01",
  endDate: null,
  birthDate: null,
  relatedTo: null,
  ...overrides,
});

test("Kenyan offices map to PEP classes", () => {
  assert.equal(pep.PEP_LEVEL_CLASS.national_executive, 1);
  assert.equal(pep.PEP_LEVEL_CLASS.parliament, 1);
  assert.equal(pep.PEP_LEVEL_CLASS.county_executive, 2, "governors are regional");
  assert.equal(pep.PEP_LEVEL_CLASS.county_government, 3, "MCAs and county executives are local government");
  assert.equal(pep.PEP_LEVEL_CLASS.state_corporation, 3);
  assert.equal(pep.PEP_LEVEL_CLASS.family_associate, 4);
  for (const level of pep.PEP_LEVELS) assert.ok(pep.PEP_LEVEL_LABELS[level], level);
});

test("register matching: spelling variants match, a different date of birth rules out", () => {
  const variant = pep.matchPepEntry({ name: "Cabdullaahi Maxamed Xuseen" }, entry());
  assert.equal(variant.method, "normalized");
  assert.equal(variant.nameScore, 96);
  assert.equal(pep.matchPepEntry({ name: "Abdullahi Mohamed Hussein", dateOfBirth: "1990-01-01" }, entry({ birthDate: "1971-05-02" })), null);
  assert.equal(pep.matchPepEntry({ name: "Abdullahi Mohamed Hussein", dateOfBirth: "1971" }, entry({ birthDate: "1971-05-02" })).birthDateMatch, "match");
  assert.equal(pep.matchPepEntry({ name: "Abdullahi Omar" }, entry()), null, "a shared first name isn't a match");
  assert.ok(pep.matchPepEntry({ name: "Mohamed Hussein" }, entry({ aliases: ["Mohamed Hussein"] })), "aliases are matched");
  assert.equal(pep.isCurrent({ endDate: null }), true);
  assert.equal(pep.isCurrent({ endDate: "2001-01-01" }), false);
});

test("CSV import: required columns, levels checked, quoted cells", () => {
  const csv = [
    "full_name,position,level,organisation,county,start_date,aliases,related_to",
    '"Wanjiku, Grace Njeri",Member of County Assembly,county_government,Nairobi City County Assembly,Nairobi,2022-09-15,Grace Wanjiku;G. Njeri,',
    "John Doe,Spouse,family_associate,,,,,Spouse of Hon. X (Governor)",
    "Bad Row,Something,not_a_level,,,,,",
  ].join("\n");
  const { rows, errors } = pep.parsePepCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, "Wanjiku, Grace Njeri");
  assert.deepEqual(rows[0].aliases, ["Grace Wanjiku", "G. Njeri"]);
  assert.equal(rows[0].startDate, "2022-09-15");
  assert.equal(rows[1].relatedTo, "Spouse of Hon. X (Governor)");
  assert.equal(errors.length, 1);
  assert.match(pep.parsePepCsv("name,title\nx,y").errors[0], /full_name, position and level/);
});

test("Gazette extraction: the issue goes to Claude as a document; results are cleaned", async () => {
  const calls = [];
  const client = {
    beta: {
      messages: {
        parse: async (request) => {
          calls.push(request);
          return {
            stop_reason: "end_turn",
            parsed_output: {
              appointments: [
                { fullName: "  Jane   Akinyi Otieno ", position: "Chairperson", organisation: "Kenya Ports Authority", level: "state_corporation", county: null, effectiveDate: "2026-10-01", endsAppointment: false, gazetteNotice: "Gazette Notice No. 13021" },
                { fullName: "X", position: "", organisation: null, level: "parliament", county: null, effectiveDate: "bad", endsAppointment: false, gazetteNotice: null },
              ],
            },
          };
        },
      },
    },
  };
  const result = await pep.extractGazetteAppointments(client, { pdfBase64: "JVBERi0=" }, "Vol. CXXVIII No. 181");
  assert.equal(result.length, 1, "empty and too-short entries are dropped");
  assert.equal(result[0].fullName, "Jane Akinyi Otieno");
  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.equal(calls[0].messages[0].content[0].type, "document");
  assert.equal(calls[0].messages[0].content[0].source.media_type, "application/pdf");
  assert.match(calls[0].system, /County Executive Committee members/);
  assert.match(calls[0].system, /Do not extract: land, probate/);
});

test("wiring: register hits are PEP cases for review, never a reject; nothing scrapes the Gazette", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /source: "KE_PEP" as const/);
  assert.match(aml, /categories: \["pep" as const\]/);
  assert.match(aml, /\(mediaHits\.length > 0 \|\| pepMatches\.length > 0 \|\| riskListMatches\.length > 0\) && decision\.verdict === "pass" \? "review"/);
  assert.match(aml, /clearedKey\("KE_PEP", entry\._id\)/, "cleared-hit memory applies");
  const register = read("backend/convex/pepRegister.ts");
  assert.doesNotMatch(register, /kenyalaw\.org|fetch\(/, "the Gazette is uploaded, never downloaded");
  assert.match(register, /approveGazette/);
  assert.match(read("backend/convex/schema.ts"), /v\.literal\("KE_PEP"\)/);
  assert.match(read("app/internal-ops/ops-nav.tsx"), /\/internal-ops\/pep-register/);
});
