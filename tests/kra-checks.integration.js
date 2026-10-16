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

const kra = loadTs("backend/convex/lib/kraGava.ts");
const found = { Message: "Valid PIN", PINDATA: { KRAPIN: "A012345678Z", TypeOfTaxpayer: "Individual", Name: "JOHN KAMAU", StatusOfPIN: "Active" } };

test("config: keys from developer.go.ke, production unless sandbox is set", () => {
  assert.equal(kra.kraConfigFromEnv({}), null);
  assert.equal(kra.kraConfigFromEnv({ KRA_GAVA_CONSUMER_KEY: "k", KRA_GAVA_CONSUMER_SECRET: "s" }).baseUrl, "https://api.kra.go.ke");
  assert.equal(kra.kraConfigFromEnv({ KRA_GAVA_CONSUMER_KEY: "k", KRA_GAVA_CONSUMER_SECRET: "s", KRA_GAVA_ENVIRONMENT: "Sandbox" }).baseUrl, "https://sbx.kra.go.ke");
});

test("responses: a taxpayer, an unknown PIN, or an error", () => {
  assert.deepEqual(kra.parseKraPinResponse(found), { status: "found", pin: "A012345678Z", name: "JOHN KAMAU", taxpayerType: "Individual", pinStatus: "Active" });
  assert.equal(kra.parseKraPinResponse({ ErrorMessage: "Invalid PIN" }).status, "not_found");
  assert.equal(kra.parseKraPinResponse({ ErrorMessage: "PIN does not exist" }).status, "not_found");
  assert.equal(kra.parseKraPinResponse({ ErrorMessage: "Service temporarily down" }).status, "error");
  assert.equal(kra.parseKraPinResponse(null).status, "error");
});

test("comparison: verified, not registered, another name, inactive, unavailable", () => {
  assert.equal(kra.compareKraRecord(kra.parseKraPinResponse(found), "John Kamau").outcome, "verified");
  assert.equal(kra.compareKraRecord({ status: "not_found", message: "x" }, "John Kamau").outcome, "not_registered");
  assert.match(kra.compareKraRecord(kra.parseKraPinResponse(found), "Mary Wanjiru").message, /registers this PIN to "JOHN KAMAU", not "Mary Wanjiru"/);
  const dormant = { ...found, PINDATA: { ...found.PINDATA, StatusOfPIN: "Dormant" } };
  assert.equal(kra.compareKraRecord(kra.parseKraPinResponse(dormant), "John Kamau").outcome, "inactive");
  assert.equal(kra.compareKraRecord({ status: "error", message: "down" }, "John Kamau").outcome, "unavailable");
  assert.equal(kra.checkablePin(" a012345678z "), "A012345678Z");
  assert.equal(kra.checkablePin("B123"), null);
});

test("the lookup signs in once with Basic auth, then posts the PIN with the token", async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes("/v1/token/generate") ? { access_token: "tok", expires_in: "3599" } : found;
    return { status: 200, json: async () => body };
  };
  try {
    const lookup = kra.kraPinLookup({ consumerKey: "key", consumerSecret: "secret", baseUrl: "https://sbx.kra.go.ke" });
    assert.equal((await lookup("A012345678Z")).status, "found");
    await lookup("A012345678Z");
    assert.equal(calls.filter((call) => call.url.includes("token")).length, 1, "the token is reused");
    assert.equal(calls[0].url, "https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials");
    assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("key:secret").toString("base64")}`);
    assert.equal(calls[1].url, "https://sbx.kra.go.ke/checker/v1/pinbypin");
    assert.equal(calls[1].init.headers.Authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(calls[1].init.body), { KRAPIN: "A012345678Z" });
  } finally {
    global.fetch = original;
  }
});

test("an outage is an error result, never an exception", async () => {
  const original = global.fetch;
  global.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const result = await kra.kraPinLookup({ consumerKey: "k", consumerSecret: "s", baseUrl: "https://api.kra.go.ke" })("A012345678Z");
    assert.deepEqual(result, { status: "error", message: "KRA couldn't be reached." });
  } finally {
    global.fetch = original;
  }
});

test("wiring: KRA PIN certificates and KYB check KRA's records", () => {
  const pipeline = read("backend/convex/lib/documentPipeline.ts");
  assert.match(pipeline, /if \(pin && deps\.kra\)/);
  assert.match(pipeline, /code: "kra_pin_not_registered", severity: "high"/);
  assert.match(read("backend/convex/documentsNode.ts"), /kra: \(\(\) => \{\s*const config = kraConfigFromEnv\(process\.env\)/);
  const kyb = read("backend/convex/kybNode.ts");
  assert.match(kyb, /checkablePin\(lookup\.record\.kraPin\)/);
  assert.match(kyb, /compareKraRecord\(await kraPinLookup\(kraConfig\)\(registeredPin\), input\.businessName, normalizeCompanyName\)/);
  assert.match(read("backend/convex/backOfficeHealth.ts"), /key: "KRA_GAVA_CONSUMER_KEY"/);
});
