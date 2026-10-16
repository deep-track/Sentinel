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

const kyb = loadTs("backend/convex/lib/kybChecks.ts");

const fields = (overrides = {}) => ({
  documentType: "certificate_of_incorporation",
  companyName: "ACME (KENYA) LTD.",
  registrationNumber: "PVT-AB12CD3",
  incorporationDate: "2019-03-04",
  jurisdiction: "KEN",
  issuingAuthority: "Registrar of Companies",
  directors: [],
  ...overrides,
});
const declared = { businessName: "Acme Kenya Limited", registrationNumber: "pvt ab12cd3", directors: ["Jane Wanjiru"] };

test("the certificate must match the declared business", () => {
  const ok = kyb.certificateRules(fields(), declared);
  assert.deepEqual(ok.flags, [], "LTD = Limited, punctuation and case don't matter");
  assert.equal(ok.checks.find((check) => check.name === "Registration number matches").status, "passed");

  const other = kyb.certificateRules(fields({ companyName: "Zenith Holdings Limited", registrationNumber: "PVT-ZZ99" }), declared);
  assert.deepEqual(other.flags.map((flag) => flag.code), ["business_name_mismatch", "registration_number_mismatch"]);

  const future = kyb.certificateRules(fields({ incorporationDate: "2999-01-01" }), declared);
  assert.equal(future.flags.find((flag) => flag.code === "incorporation_date_in_future").severity, "critical");

  const unreadable = kyb.certificateRules(fields({ companyName: null, registrationNumber: null }), declared);
  assert.deepEqual(unreadable.flags.map((flag) => flag.severity), ["medium", "medium"]);
});

test("a CR12 must list the declared directors", () => {
  const today = new Date().toISOString().slice(0, 10);
  const listed = kyb.certificateRules(fields({ documentType: "cr12", documentDate: today, directors: ["WANJIRU Jane", "Peter Otieno"] }), declared);
  assert.equal(listed.flags.length, 0);
  const missing = kyb.certificateRules(fields({ documentType: "cr12", documentDate: today, directors: ["Peter Otieno"] }), declared);
  assert.equal(missing.flags[0].code, "director_not_on_document");
});

test("the KYB verdict: any rejection rejects, anything unclear goes to review, only all-clear passes", () => {
  const clean = { verdict: "pass", reason: "ok" };
  const party = (overrides = {}) => ({ name: "Jane Wanjiru", role: "director", verdict: "pass", complete: true, reason: "No match", ...overrides });
  const business = party({ name: "Acme", role: "business" });
  assert.equal(kyb.decideKyb({ certificate: clean, proofOfAddress: clean, parties: [business, party()] }).verdict, "pass");

  const hit = kyb.decideKyb({ certificate: clean, proofOfAddress: clean, parties: [business, party({ verdict: "review", reason: "PEP Class 2 hit" })] });
  assert.equal(hit.verdict, "review");
  assert.match(hit.reason, /Jane Wanjiru \(director, AML\): PEP Class 2 hit/);

  const sanctioned = kyb.decideKyb({ certificate: { verdict: "review", reason: "name mismatch" }, proofOfAddress: clean, parties: [business, party({ verdict: "reject", reason: "OFAC SDN" })] });
  assert.equal(sanctioned.verdict, "reject", "a rejection outranks review");

  const outage = kyb.decideKyb({ certificate: { verdict: "unavailable", reason: "x" }, proofOfAddress: clean, parties: [business, party({ complete: false })] });
  assert.equal(outage.verdict, "review");
  assert.equal(outage.complete, false, "not charged when the checks couldn't run");
  assert.match(outage.reason, /couldn't be checked automatically/);
});

test("only Sentinel's upload service is fetched", () => {
  assert.equal(kyb.isAllowedDocumentUrl("https://utfs.io/f/abc.pdf"), true);
  assert.equal(kyb.isAllowedDocumentUrl("https://x7y8.ufs.sh/f/abc.pdf"), true);
  assert.equal(kyb.isAllowedDocumentUrl("http://utfs.io/f/abc.pdf"), false, "https only");
  assert.equal(kyb.isAllowedDocumentUrl("https://evil.example/utfs.io"), false);
  assert.equal(kyb.isAllowedDocumentUrl("https://169.254.169.254/latest"), false);
  assert.equal(kyb.normalizeRegistrationNumber(" pvt-ab 12/cd3 "), "PVTAB12CD3");
});

test("wiring: KYB runs the automated checks and stores categorised hits", () => {
  const kybSource = read("backend/convex/kyb.ts");
  assert.match(kybSource, /ctx\.scheduler\.runAfter\(0, internalApi\.kybNode\.processKyb, args\)/);
  assert.match(kybSource, /return await screenSubjects\(ctx, subjects, rules\);/);
  assert.match(kybSource, /await ctx\.db\.insert\("flaggedEntities", \{/, "hits feed the review case category");
  assert.match(kybSource, /if \(args\.complete\) \{\s*await chargeVerification/);
  const node = read("backend/convex/kybNode.ts");
  assert.match(node, /^"use node";/);
  assert.match(node, /if \(!isAllowedDocumentUrl\(url\)\) return/);
  assert.match(node, /documentKind: "proof_of_address", front: poaFile\.bytes, expected: \{ name: input\.businessName \}/);
  assert.match(node, /await manual\("Business verification needs a person: the automatic checks couldn't finish\."\)/);
  assert.match(read("backend/convex/documentsNode.ts"), /export function textractOcr\(\): OcrProvider \| null \{/);
});

// ── Kenya BRS (MetaMap) ─────────────────────────────────────────────────────

const brs = loadTs("backend/convex/lib/kenyaBrs.ts");

const brsBody = (overrides = {}) => ({
  status: 200,
  id: "kenyan-brs-validation",
  error: null,
  data: {
    registrationNumber: "PVT-AB12CD3",
    companyName: "ACME KENYA LTD",
    registrationDate: "2010-01-01",
    registrationStatus: true,
    kraPIN: "P000000000H",
    shareHolders: [
      { name: "JANE WANJIRU", shares: "2 ORDINARY", idType: "citizen", idNumber: "12345678" },
      { name: "PETER OTIENO", shares: "5 ORDINARY", idType: "citizen", idNumber: "87654321" },
    ],
    ...overrides,
  },
});
const brsDeclared = { businessName: "Acme Kenya Limited", registrationNumber: "PVT-AB12CD3", people: ["Jane Wanjiru"] };

test("BRS responses: found, not found, pending and errors", () => {
  const found = brs.readBrsResponse(brsBody());
  assert.equal(found.status, "found");
  assert.equal(found.record.active, true);
  assert.equal(found.record.kraPin, "P000000000H");
  assert.equal(found.record.shareholders.length, 2);
  assert.equal(brs.readBrsResponse({ data: null, error: { type: "govCheckError", code: "kenyanBrs.notFound", message: "No results" } }).status, "not_found");
  assert.equal(brs.readBrsResponse({ data: null, error: { code: "kenyanBrs.timeout", message: "Timed out" } }).status, "error");
  assert.equal(brs.readBrsResponse({ status: 200, data: null, error: null }).status, "pending");
  assert.equal(brs.isKenya("KE"), true);
  assert.equal(brs.isKenya("UG"), false);
  assert.equal(brs.metamapConfigured({ METAMAP_CLIENT_ID: "a", METAMAP_CLIENT_SECRET: " " }), false);
});

test("BRS comparison: name, active status, undeclared shareholders", () => {
  const clean = brs.compareBrs(brs.readBrsResponse(brsBody({ shareHolders: [{ name: "JANE WANJIRU" }] })), brsDeclared);
  assert.equal(clean.outcome.verdict, "pass");

  const extra = brs.compareBrs(brs.readBrsResponse(brsBody()), brsDeclared);
  assert.equal(extra.outcome.verdict, "review");
  assert.deepEqual(extra.undeclaredShareholders.map((holder) => holder.name), ["PETER OTIENO"]);

  const inactive = brs.compareBrs(brs.readBrsResponse(brsBody({ registrationStatus: false, shareHolders: [] })), brsDeclared);
  assert.equal(inactive.outcome.verdict, "review");
  assert.match(inactive.outcome.reason, /isn't active/);

  const renamed = brs.compareBrs(brs.readBrsResponse(brsBody({ companyName: "ZEBRA HOLDINGS LTD", shareHolders: [] })), brsDeclared);
  assert.match(renamed.outcome.reason, /ZEBRA HOLDINGS/);

  assert.equal(brs.compareBrs({ status: "not_found", message: "x" }, brsDeclared).outcome.verdict, "review");
  assert.equal(brs.compareBrs({ status: "pending" }, brsDeclared).outcome.verdict, "unavailable");
});

test("the registry outcome feeds the KYB verdict", () => {
  const ok = { verdict: "pass", reason: "ok" };
  const parties = [{ name: "Acme", role: "business", verdict: "pass", complete: true, reason: "clear" }];
  assert.equal(kyb.decideKyb({ certificate: ok, proofOfAddress: ok, parties, registry: ok }).verdict, "pass");
  const held = kyb.decideKyb({ certificate: ok, proofOfAddress: ok, parties, registry: { verdict: "unavailable", reason: "x" } });
  assert.equal(held.verdict, "review");
  assert.equal(held.complete, false);
  assert.match(held.reason, /Company registry/);
  assert.equal(kyb.decideKyb({ certificate: ok, proofOfAddress: ok, parties }).verdict, "pass", "no registry lookup outside Kenya");
});

test("MetaMap requests: client-credentials token, then the BRS call with the callback URL", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth")) return { ok: true, status: 200, json: async () => ({ access_token: "jwt" }) };
    return { ok: true, status: 200, text: async () => JSON.stringify(brsBody()) };
  };
  const result = await brs.requestBrs({ registrationNumber: " PVT-AB12CD3 ", callbackUrl: "https://x.convex.site/webhooks/metamap/brs?token=t", clientId: "id", clientSecret: "secret" }, fetchImpl);
  assert.equal(result.status, "found");
  assert.equal(calls[0].url, "https://api.prod.metamap.com/oauth");
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
  assert.equal(calls[0].init.body, "grant_type=client_credentials");
  assert.equal(calls[1].url, "https://api.prod.metamap.com/govchecks/v1/ke/brs");
  assert.equal(calls[1].init.headers.Authorization, "Bearer jwt");
  assert.deepEqual(JSON.parse(calls[1].init.body), { registrationNumber: "PVT-AB12CD3", callbackURL: "https://x.convex.site/webhooks/metamap/brs?token=t" });

  const pending = await brs.requestBrs({ registrationNumber: "x", callbackUrl: "u", clientId: "a", clientSecret: "b" }, async (url) =>
    url.endsWith("/oauth") ? { ok: true, status: 200, json: async () => ({ access_token: "jwt" }) } : { ok: true, status: 200, text: async () => "" },
  );
  assert.equal(pending.status, "pending");
  await assert.rejects(brs.requestBrs({ registrationNumber: "x", callbackUrl: "u", clientId: "a", clientSecret: "b" }, async () => ({ ok: false, status: 401 })), /authentication failed/);
});

test("wiring: Kenyan KYB looks up BRS, waits for the callback, screens undeclared shareholders", () => {
  const node = read("backend/convex/kybNode.ts");
  assert.match(node, /isKenya\(input\.incorporationCountry\) && metamapConfigured\(\)/);
  assert.match(node, /undeclaredShareholders\.map/);
  assert.match(node, /_registryLookup/);
  const http = read("backend/convex/http.ts");
  assert.match(http, /path: "\/webhooks\/metamap\/brs"/);
  assert.match(http, /\^\[0-9a-f\]\{64\}\$/);
  const kybSource = read("backend/convex/kyb.ts");
  assert.match(kybSource, /tokenHash = await sha256Hex\(args\.token\)/);
  assert.match(kybSource, /lateResponse/);
  assert.match(read("backend/convex/schema.ts"), /kybRegistryLookups: defineTable/);
});
