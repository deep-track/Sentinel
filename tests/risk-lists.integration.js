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

const lists = loadTs("backend/convex/lib/riskLists.ts");

test("robots.txt: our rules win over *, the longest rule wins, AI-crawler blocks are respected by name", () => {
  const kenyaLaw = "User-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /api/\n\nUser-agent: anthropic-ai\nDisallow: /\n";
  assert.equal(lists.robotsAllows(kenyaLaw, "/gazettes/2026"), true);
  assert.equal(lists.robotsAllows(kenyaLaw, "/search/?q=x"), false);
  assert.equal(lists.robotsAllows("User-agent: SentinelRiskLists\nDisallow: /\n\nUser-agent: *\nAllow: /\n", "/debarred"), false, "a rule for our agent applies");
  assert.equal(lists.robotsAllows("User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n", "/docs/public/list.pdf"), true, "the longer rule wins");
  assert.equal(lists.robotsAllows("User-agent: *\nDisallow: /*.pdf$\n", "/files/list.pdf"), false, "wildcards and anchors");
  assert.equal(lists.robotsAllows("", "/anything"), true, "no robots.txt allows");
  assert.equal(lists.robotsAllows("User-agent: Googlebot\nDisallow: /\n", "/x"), true, "rules for other agents don't apply");
});

test("pages are fetched only over https from the authority's own domain", () => {
  assert.ok(lists.allowedPageUrl("KE_PPRA_DEBARRED", "https://ppra.go.ke/debarred-firms/"));
  assert.ok(lists.allowedPageUrl("KE_CMA_ENFORCEMENT", "https://www.cma.or.ke/enforcement-actions/"));
  assert.equal(lists.allowedPageUrl("KE_PPRA_DEBARRED", "http://ppra.go.ke/x"), null);
  assert.equal(lists.allowedPageUrl("KE_PPRA_DEBARRED", "https://ppra.go.ke.evil.com/x"), null);
  assert.equal(lists.allowedPageUrl("KE_PPRA_DEBARRED", "https://cma.or.ke/x"), null, "another authority's site");
  assert.equal(lists.allowedPageUrl("KE_OTHER", "https://example.go.ke/x"), null, "other notices are uploaded only");
  assert.equal(lists.htmlToText("<table><tr><td>Acme Ltd</td><td>Debarred</td></tr></table><script>x()</script>"), "| Acme Ltd | Debarred");
});

const entry = (overrides = {}) => ({ _id: "r1", sourceKey: "KE_PPRA_DEBARRED", name: "Savannah Supplies Limited", aliases: [], entityType: "entity", reason: "Fraudulent tender documents", action: "Debarred for 3 years", startDate: "2025-01-10", endDate: "2028-01-10", reference: "PPRA/DEB/12/2025", ...overrides });

test("matching: company legal forms ignored, people and organisations kept apart, ended entries marked", () => {
  const company = lists.matchRiskEntry({ name: "SAVANNAH SUPPLIES LTD", entityType: "entity" }, entry());
  assert.equal(company.method, "exact");
  assert.equal(company.ended, false);
  assert.equal(lists.matchRiskEntry({ name: "Savannah Supplies", entityType: "individual" }, entry()), null);
  assert.equal(lists.matchRiskEntry({ name: "Savannah Logistics Ltd", entityType: "entity" }, entry()), null);
  const person = lists.matchRiskEntry({ name: "Cabdi Xasan Maxamed", entityType: "individual" }, entry({ name: "Abdi Hassan Mohamed", entityType: "individual", endDate: "2020-01-01" }));
  assert.equal(person.method, "normalized");
  assert.equal(person.ended, true);
});

test("CSV import and extraction request", async () => {
  const { rows, errors } = lists.parseRiskCsv('name,entity_type,reason,action,end_date,reference\n"Acme, Ltd",entity,Collusion in tender,Debarred 2 years,2027-03-01,PPRA/1\nJohn Doe,person,x,,,\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Acme, Ltd");
  assert.equal(rows[0].endDate, "2027-03-01");
  assert.match(errors[0], /entity_type/);

  const calls = [];
  const client = {
    beta: {
      messages: {
        parse: async (request) => {
          calls.push(request);
          return { stop_reason: "end_turn", parsed_output: { entries: [{ name: " Acme  Ltd ", aliases: [], entityType: "entity", reason: "Collusion", action: "Debarred", startDate: "2026-01-01", endDate: "bad", reference: null }] } };
        },
      },
    },
  };
  const result = await lists.extractRiskEntries(client, "KE_PPRA_DEBARRED", { text: "Acme Ltd debarred" }, "PPRA list");
  assert.equal(result[0].name, "Acme Ltd");
  assert.equal(result[0].endDate, null);
  assert.match(calls[0].system, /Public Procurement Regulatory Authority/);
  assert.equal(calls[0].model, "claude-opus-5-5");
});

test("wiring: hits go to review in the list's category; fetching checks robots.txt and stays on site", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /source: "KE_RISK_LIST" as const/);
  assert.match(aml, /riskListMatches\.length > 0\) && decision\.verdict === "pass" \? "review"/);
  assert.match(aml, /clearedKey\("KE_RISK_LIST", entry\._id\)/);
  const module = read("backend/convex/riskLists.ts");
  assert.match(module, /if \(!robotsAllows\(robots, url\.pathname \+ url\.search\)\)/);
  assert.match(module, /allowedPageUrl\(sourceKey, response\.url\)/, "redirects stay on the authority's site");
  assert.ok(module.indexOf("robots.txt") < module.indexOf("fetch(url.toString()"), "robots.txt is read before the page");
  assert.equal(lists.RISK_LIST_SOURCES.find((source) => source.key === "KE_DCI_WANTED").category, "special_interest");
  assert.equal(lists.RISK_LIST_SOURCES.find((source) => source.key === "KE_CBK_ENFORCEMENT").category, "fitness_probity");
});
