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

const parsers = loadTs("backend/convex/lib/watchlistParsers.ts");
const matching = loadTs("backend/convex/lib/amlMatching.ts");
const media = loadTs("backend/convex/lib/adverseMedia.ts");

const EU_XML = `<?xml version="1.0" encoding="UTF-8"?>
<export generationDate="2026-10-13T00:00:00">
  <sanctionEntity designationDate="2003-07-07" logicalId="13" euReferenceNumber="EU.27.28" unitedNationId="IQi.001">
    <regulation regulationType="regulation" programme="IRQ" publicationDate="2003-07-08"/>
    <subjectType code="person" classificationCode="P"/>
    <nameAlias firstName="Saddam" lastName="Al-Tikriti" wholeName="Saddam Hussein Al-Tikriti" function="" logicalId="17"/>
    <nameAlias wholeName="Abu Ali" logicalId="18"/>
    <nameAlias wholeName="Abu Ali" logicalId="19"/>
    <citizenship countryIso2Code="IQ" countryDescription="IRAQ"/>
    <address countryIso2Code="00" countryDescription="UNKNOWN"/>
  </sanctionEntity>
  <sanctionEntity logicalId="900" euReferenceNumber="EU.900.1">
    <regulation programme="RUS"/>
    <subjectType code="enterprise" classificationCode="E"/>
    <nameAlias firstName="" middleName="" lastName="" wholeName="Example Bank &amp; Trust JSC"/>
    <address countryDescription="RUSSIAN FEDERATION"/>
  </sanctionEntity>
</export>`;

const UK_XML = `<?xml version="1.0" encoding="utf-8"?>
<Designations>
  <Designation>
    <LastUpdated>2026-10-01</LastUpdated>
    <UniqueID>AFG0006</UniqueID>
    <RegimeName>The Afghanistan (Sanctions) (EU Exit) Regulations 2020</RegimeName>
    <IndividualEntityShip>Individual</IndividualEntityShip>
    <Names>
      <Name><Name6>AKHUND</Name6><Name1>Mohammad</Name1><Name2>Hassan</Name2><NameType>Primary Name</NameType></Name>
      <Name><Name6>AKHUND</Name6><Name1>Mullah</Name1><NameType>Alias</NameType></Name>
    </Names>
    <NonLatinNames><NonLatinName><NameNonLatinScript>محمد حسن</NameNonLatinScript></NonLatinName></NonLatinNames>
    <IndividualDetails><Individual><Nationalities><Nationality>Afghanistan</Nationality></Nationalities></Individual></IndividualDetails>
  </Designation>
  <Designation>
    <UniqueID>RUS0001</UniqueID>
    <RegimeName>The Russia (Sanctions) (EU Exit) Regulations 2019</RegimeName>
    <IndividualEntityShip>Ship</IndividualEntityShip>
    <Names><Name><Name6>SEA STAR</Name6><NameType>Primary Name</NameType></Name></Names>
    <Addresses><Address><AddressCountry>Russia</AddressCountry></Address></Addresses>
  </Designation>
</Designations>`;

// ── Parsers ─────────────────────────────────────────────────────────────────

test("EU consolidated list: reference number, names, type, countries, programme", () => {
  const [person, enterprise] = parsers.parseSource("EU_FSF", EU_XML);
  assert.equal(person.sourceRecordId, "EU.27.28");
  assert.equal(person.entityType, "individual");
  assert.equal(person.primaryName, "Saddam Hussein Al-Tikriti");
  assert.deepEqual(person.aliases, ["Abu Ali"], "duplicate aliases collapse");
  assert.deepEqual(person.countries, ["IRAQ"], "UNKNOWN countries are dropped");
  assert.deepEqual(person.programs, ["IRQ"]);
  assert.ok(person.normalizedNames.includes("SADDAM HUSSEIN AL TIKRITI"));
  assert.equal(enterprise.entityType, "entity");
  assert.equal(enterprise.primaryName, "Example Bank & Trust JSC", "XML entities are decoded");
  assert.deepEqual(enterprise.countries, ["RUSSIAN FEDERATION"]);
  assert.throws(() => parsers.parseEu("<html>maintenance</html>"), /sanctionEntity/);
});

test("UK sanctions list: unique ID, primary name from parts, aliases incl. non-Latin, ships as entities", () => {
  const [person, ship] = parsers.parseSource("UK_SANCTIONS", UK_XML);
  assert.equal(person.sourceRecordId, "AFG0006");
  assert.equal(person.entityType, "individual");
  assert.equal(person.primaryName, "Mohammad Hassan AKHUND");
  assert.ok(person.aliases.includes("Mullah AKHUND"));
  assert.ok(person.aliases.includes("محمد حسن"));
  assert.deepEqual(person.countries, ["Afghanistan"]);
  assert.match(person.programs[0], /Afghanistan/);
  assert.equal(ship.entityType, "entity");
  assert.equal(ship.primaryName, "SEA STAR");
  assert.deepEqual(ship.countries, ["Russia"]);
  assert.throws(() => parsers.parseUk("<Designations></Designations>"), /Designation/);
});

// ── Coverage and wiring ─────────────────────────────────────────────────────

test("EU and UK are sources; they only count towards coverage once loaded", () => {
  assert.ok(matching.SOURCE_KEYS.includes("EU_FSF"));
  assert.ok(matching.SOURCE_KEYS.includes("UK_SANCTIONS"));
  assert.deepEqual(matching.SOURCES_REQUIRED_AFTER_FIRST_LOAD, ["EU_FSF", "UK_SANCTIONS"]);
  for (const key of matching.SOURCE_KEYS) assert.ok(matching.SOURCE_DISPLAY_NAMES[key], `${key} has a display name`);
  const persistence = read("backend/convex/amlPersistence.ts");
  assert.match(persistence, /SOURCES_REQUIRED_AFTER_FIRST_LOAD\.includes\(sourceKey\) && !source\?\.lastSuccessfulAt\) continue/);
  const crons = read("backend/convex/crons.ts");
  assert.match(crons, /watchlists\.ingestEu/);
  assert.match(crons, /watchlists\.ingestUk/);
  const watchlists = read("backend/convex/watchlists.ts");
  assert.match(watchlists, /WATCHLIST_EU_FSF_URL/);
  assert.match(watchlists, /WATCHLIST_UK_SANCTIONS_URL/);
  const schema = read("backend/convex/schema.ts");
  assert.ok((schema.match(/v\.literal\("UK_SANCTIONS"\)/g) ?? []).length >= 4, "every source union accepts the new keys");
});

test("media hits map insolvency and regulator actions to their categories", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /riskTypes\.includes\("insolvency"\) \? \(\["insolvency"\]/);
  assert.match(aml, /riskTypes\.includes\("regulatory_action"\) \? \(\["fitness_probity"\]/);
});

// ── Kenyan official records ─────────────────────────────────────────────────

const searchResult = (url) => ({ type: "web_search_tool_result", content: [{ type: "web_search_result", url, title: "t", encrypted_content: "x", page_age: null }] });
const webArticle = (url, riskTypes = ["insolvency"]) => ({
  url,
  title: "Jane Wanjiru winding-up notice",
  domain: null,
  publishedAt: "2026-09-30",
  aboutSubject: "yes",
  severity: "high",
  riskTypes,
  summary: "Winding-up notice.",
});
const reply = (urls, riskTypes) => ({ stop_reason: "end_turn", content: urls.map(searchResult), parsed_output: { articles: urls.map((url) => webArticle(url, riskTypes)) } });
const kenyan = { name: "Jane Wanjiru", entityType: "individual", country: "KE" };

test("Kenyan subjects: a second search limited to Kenyan official sources, merged without duplicates", async () => {
  assert.equal(media.isKenyanSubject({ country: "KE" }), true);
  assert.equal(media.isKenyanSubject({ nationality: "Kenya" }), true);
  assert.equal(media.isKenyanSubject({ jurisdiction: " ken " }), true);
  assert.equal(media.isKenyanSubject({ country: "UG" }), false);

  const calls = [];
  const client = {
    beta: {
      messages: {
        parse: async (request) => {
          calls.push(request);
          return request.tools[0].allowed_domains
            ? reply(["https://news.example/a", "https://new.kenyalaw.org/gazette/1"])
            : reply(["https://news.example/a"]);
        },
      },
    },
  };
  const [outcome] = await media.screenAdverseMediaMany([kenyan], { provider: media.WEB_SEARCH_PROVIDER, client });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tools[0].allowed_domains, undefined, "the news search is open");
  assert.deepEqual(calls[1].tools[0].allowed_domains, media.KENYA_RECORD_DOMAINS);
  assert.match(calls[1].system, /Kenya Gazette/);
  assert.equal(outcome.status, "screened");
  assert.equal(outcome.hits.length, 2, "the URL found by both searches counts once");

  calls.length = 0;
  await media.screenAdverseMediaMany([{ ...kenyan, name: "John Okello", country: "UG" }], { provider: media.WEB_SEARCH_PROVIDER, client });
  assert.equal(calls.length, 1, "other subjects get the news search only");
});

test("Kenyan records search failing doesn't fail the news screening", async () => {
  const errors = [];
  const client = {
    beta: {
      messages: {
        parse: async (request) => {
          if (request.tools[0].allowed_domains) throw Object.assign(new Error("overloaded"), { status: 529 });
          return reply(["https://news.example/a"], ["fraud"]);
        },
      },
    },
  };
  const [outcome] = await media.screenAdverseMediaMany([kenyan], {
    provider: media.WEB_SEARCH_PROVIDER,
    client,
    onError: (error) => errors.push(error),
  });
  assert.equal(outcome.status, "screened");
  assert.equal(outcome.hits.length, 1);
  assert.equal(errors.length, 1);
});
