const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative, stubs = {}) {
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = (specifier) => (specifier in stubs ? stubs[specifier] : require(specifier));
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const goaml = loadTs("backend/convex/lib/goaml.ts");

const base = {
  rentityId: "1234",
  entityReference: "STR-20261015-ABC123",
  submissionDate: new Date(Date.UTC(2026, 9, 15, 6, 30)),
  localCurrency: "KES",
  reportingPerson: { firstName: "Jane", lastName: "Wanjiru", email: "mlro@bank.co.ke", phone: "+254700000000", title: "MLRO" },
  location: { address: "Kenyatta Ave", city: "Nairobi", countryCode: "KE" },
  reason: "PEP hit & sanctions <alias> match",
  action: "Onboarding declined",
  indicators: ["IND01", " ", "IND02"],
  subject: { kind: "person", firstName: "John", lastName: "Doe", birthDate: "1980-01-02", idNumber: "12345678", nationality: "ke", country: "KE" },
};

test("a SAR reports the subject as an activity party, with the reporting entity and person", () => {
  const xml = goaml.buildGoamlXml({ ...base, reportCode: "SAR" });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<report>/);
  assert.match(xml, /<rentity_id>1234<\/rentity_id>/);
  assert.match(xml, /<submission_code>E<\/submission_code>/);
  assert.match(xml, /<report_code>SAR<\/report_code>/);
  assert.match(xml, /<submission_date>2026-10-15T06:30:00<\/submission_date>/);
  assert.match(xml, /<currency_code_local>KES<\/currency_code_local>/);
  assert.match(xml, /<reporting_person>\s*<first_name>Jane<\/first_name>\s*<last_name>Wanjiru<\/last_name>/);
  assert.match(xml, /<activity>\s*<report_parties>\s*<report_party>\s*<person>/);
  assert.match(xml, /<birthdate>1980-01-02T00:00:00<\/birthdate>/);
  assert.match(xml, /<nationality1>KE<\/nationality1>/);
  assert.match(xml, /<reason>PEP hit &amp; sanctions &lt;alias&gt; match<\/reason>/, "escaped");
  assert.match(xml, /<report_indicators>\s*<indicator>IND01<\/indicator>\s*<indicator>IND02<\/indicator>\s*<\/report_indicators>/, "blank codes dropped");
  assert.doesNotMatch(xml, /<transaction>/);
});

test("an STR carries the transaction with the customer as the from party", () => {
  const xml = goaml.buildGoamlXml({
    ...base,
    reportCode: "STR",
    transaction: { number: "TX-1", date: new Date(Date.UTC(2026, 9, 1, 8)), amount: 1500000, description: "Cash deposit", counterpartyName: "Acme", counterpartyAccount: "0011" },
  });
  assert.match(xml, /<transaction>\s*<transactionnumber>TX-1<\/transactionnumber>/);
  assert.match(xml, /<amount_local>1500000\.00<\/amount_local>/);
  assert.match(xml, /<t_from_my_client>[\s\S]*<from_person>[\s\S]*<first_name>John<\/first_name>[\s\S]*<\/from_person>[\s\S]*<\/t_from_my_client>/);
  assert.match(xml, /<t_to>[\s\S]*<to_account>\s*<account>0011<\/account>\s*<account_name>Acme<\/account_name>/);
  assert.doesNotMatch(xml, /<activity>/);
});

test("entities, unsafe characters and names", () => {
  const xml = goaml.buildGoamlXml({ ...base, reportCode: "SAR", subject: { kind: "entity", name: "Acme \u0001Ltd", registrationNumber: "PVT-1", incorporationCountry: "Kenya" } });
  assert.match(xml, /<entity>\s*<name>Acme Ltd<\/name>\s*<incorporation_number>PVT-1<\/incorporation_number>\s*<\/entity>/, "control characters removed; a country name that isn't ISO-2 is left out");
  assert.equal(goaml.escapeXml(`"'&<>`), "&quot;&apos;&amp;&lt;&gt;");
  assert.deepEqual(goaml.splitName("Jane Wanjiru Kamau"), { firstName: "Jane Wanjiru", lastName: "Kamau" });
  assert.deepEqual(goaml.splitName("Madonna"), { firstName: "Madonna", lastName: "Madonna" });
});

test("STR subjects come from the check that was reviewed", () => {
  const { goamlSubject } = loadTs("backend/convex/strReports.ts", {
    "./_generated/server": { mutation: (d) => d, query: (d) => d },
    "./lib/rbac": {},
    "./lib/crypto": {},
    "./lib/clientSettings": {},
    "./auditLog": {},
    "./reviewQueue": {},
    "./lib/goaml": goaml,
  });
  assert.deepEqual(goamlSubject({ type: "aml", reference: "ver_1", input: { subjectName: "Jane Wanjiru Kamau", entityType: "individual", dateOfBirth: "1990-05-05", country: "KE" } }), {
    kind: "person",
    firstName: "Jane Wanjiru",
    lastName: "Kamau",
    birthDate: "1990-05-05",
    idNumber: undefined,
    nationality: undefined,
    country: "KE",
  });
  assert.equal(goamlSubject({ type: "kyb", reference: "ver_2", input: { businessName: "Acme Ltd", registrationNumber: "PVT-1" } }).kind, "entity");
  assert.equal(goamlSubject({ type: "idp", reference: "ver_3", input: { firstName: "John", lastName: "Doe", idNumber: "1" } }).lastName, "Doe");
});

test("the STR register is for Admins and Reviewers, and every step is audited", () => {
  const source = read("backend/convex/strReports.ts");
  assert.match(source, /const STR_ROLES: ClientRole\[\] = \["client_admin", "reviewer"\];/);
  assert.match(source, /action: "str\.prepared"/);
  assert.match(source, /action: "str\.submitted"/);
  assert.match(source, /Add your goAML reporting entity ID in Settings → Organization first\./);
  assert.match(source, /An STR needs the suspicious transaction\./);
  assert.match(read("backend/convex/regulatorPack.ts"), /requireClientRole\(ctx, args\.clientId, \["client_admin", "reviewer", "viewer"\]\)/);
  assert.match(read("components/app-sidebar.tsx"), /\{ title: "Reports", url: "\/reports", icon: FileBarChart \}/);
});

test("the monthly pack covers a calendar month in Kenya time", () => {
  const pack = loadTs("backend/convex/regulatorPack.ts", {
    "./_generated/server": { query: (d) => d },
    "./lib/rbac": {},
    "./lib/clientSettings": {},
    "./lib/amlCategories": {},
    "./userProfiles": {},
  });
  assert.deepEqual(pack.monthBounds("2026-10"), { start: Date.UTC(2026, 9, 1) - 3 * 3600_000, end: Date.UTC(2026, 10, 1) - 3 * 3600_000 });
  assert.deepEqual(pack.monthBounds("2026-12").end, Date.UTC(2027, 0, 1) - 3 * 3600_000);
  assert.throws(() => pack.monthBounds("2026-13"), /YYYY-MM/);
  assert.equal(pack.percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(pack.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(pack.percentile([], 50), null);
});
