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
    return loadTs(path.relative(root, resolved.endsWith(".ts") ? resolved : `${resolved}.ts`), cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const c2pa = loadTs("backend/convex/lib/c2paResolution.ts");
const pipeline = loadTs("backend/convex/lib/documentPipeline.ts");

const config = {
  baseUrl: "https://c2pa.trufo.ai/v1",
  tokenUrl: "https://auth.trufo.ai/oauth/token",
  clientId: "id",
  clientSecret: "secret",
  scope: "fetch:manifests",
  alg: "ai.trufo.pawprint.fingerprint",
};

const AI_MANIFEST = Buffer.from(
  "jumb c2pa c2pa.assertions claim_generator  OpenAI DALL-E 3  c2pa.actions c2pa.created digitalSourceType http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  "latin1",
);
const CAMERA_MANIFEST = Buffer.from("jumb c2pa claim_generator  Leica M11-P  c2pa.created digitalSourceType http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture", "latin1");
const EDITED_MANIFEST = Buffer.from("jumb c2pa claim_generator  Adobe Photoshop 26  c2pa.opened c2pa.edited digitalSourceType http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture", "latin1");

function response(status, body, type = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => (Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)),
    headers: { get: () => type },
  };
}

function fakeService(manifests) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === config.tokenUrl) return response(200, { access_token: "tok", token_type: "Bearer" });
    if (url.includes("/matches/byContent")) {
      return response(200, { matches: Object.keys(manifests).map((manifestId, index) => ({ manifestId, similarityScore: 95 - index * 30 })) });
    }
    const id = decodeURIComponent(new URL(url).pathname.split("/").pop());
    return manifests[id] ? response(200, manifests[id], "application/c2pa") : response(404, {});
  };
  return { calls, fetchImpl };
}

test("config: off unless C2PA_RESOLUTION_URL is set; defaults scope to fetch:manifests", () => {
  assert.equal(c2pa.c2paConfigFromEnv({}), null);
  assert.deepEqual(c2pa.c2paConfigFromEnv({ C2PA_RESOLUTION_URL: "https://c2pa.trufo.ai/v1/" }), {
    baseUrl: "https://c2pa.trufo.ai/v1",
    tokenUrl: undefined,
    clientId: undefined,
    clientSecret: undefined,
    scope: "fetch:manifests",
    alg: undefined,
  });
});

test("requests follow the spec: client-credentials token, POST /matches/byContent, GET /manifests/{id}", async () => {
  const { calls, fetchImpl } = fakeService({ "urn:c2pa:abc": AI_MANIFEST });
  const outcome = await c2pa.lookupContentCredentials(config, Uint8Array.from([1, 2, 3]), "image/jpeg", { fetchImpl });
  const [token, match, manifest] = calls;
  assert.equal(token.init.method, "POST");
  assert.equal(token.init.headers.Authorization, `Basic ${btoa("id:secret")}`);
  assert.match(token.init.body, /grant_type=client_credentials/);
  assert.match(token.init.body, /scope=fetch%3Amanifests/);

  const matchUrl = new URL(match.url);
  assert.equal(matchUrl.pathname, "/v1/matches/byContent");
  assert.equal(matchUrl.searchParams.get("maxResults"), String(c2pa.C2PA_MAX_RESULTS));
  assert.equal(matchUrl.searchParams.get("alg"), "ai.trufo.pawprint.fingerprint");
  assert.equal(match.init.headers["Content-Type"], "image/jpeg");
  assert.equal(match.init.headers.Authorization, "Bearer tok");

  const manifestUrl = new URL(manifest.url);
  assert.equal(manifestUrl.pathname, `/v1/manifests/${encodeURIComponent("urn:c2pa:abc")}`);
  assert.equal(manifestUrl.searchParams.get("returnActiveManifest"), "true");
  assert.equal(manifest.init.headers.Accept, "application/c2pa");

  assert.equal(outcome.status, "checked");
  assert.equal(outcome.findings[0].digitalSourceType, "ai_generated");
  assert.equal(outcome.findings[0].claimGenerator, "OpenAI DALL-E 3");
  assert.deepEqual(outcome.flags.map((flag) => [flag.code, flag.severity]), [["c2pa_registry_ai_generated", "critical"]]);
  assert.match(outcome.flags[0].message, /generated by AI \(OpenAI DALL-E 3\), 95% match/);
});

test("manifests: camera captures are clean, edits are medium, weak matches ignored", async () => {
  assert.equal(c2pa.interpretManifest(CAMERA_MANIFEST, { manifestId: "a", similarityScore: 99 }).digitalSourceType, "digital_capture");
  assert.deepEqual(c2pa.c2paFlags([c2pa.interpretManifest(CAMERA_MANIFEST, { manifestId: "a", similarityScore: 99 })]), []);
  const edited = c2pa.c2paFlags([c2pa.interpretManifest(EDITED_MANIFEST, { manifestId: "b", similarityScore: 90 })]);
  assert.deepEqual(edited.map((flag) => [flag.code, flag.severity]), [["c2pa_registry_edited", "medium"]]);
  const camera = c2pa.interpretManifest(Buffer.from("claim_generator  Google Pixel 9  digitalCapture", "latin1"), { manifestId: "c", similarityScore: 90 });
  assert.equal(camera.digitalSourceType, "digital_capture", "a camera maker's name isn't an AI generator");

  // Second match scores 65, below C2PA_MIN_SIMILARITY: not fetched.
  const { calls, fetchImpl } = fakeService({ strong: CAMERA_MANIFEST, weak: AI_MANIFEST });
  const outcome = await c2pa.lookupContentCredentials(config, Uint8Array.from([1]), "image/png", { fetchImpl });
  assert.equal(outcome.matches, 1);
  assert.equal(calls.filter((call) => call.url.includes("/manifests/")).length, 1);
  assert.deepEqual(outcome.flags, []);
});

test("safety: only public https endpoints, our token never sent to other hosts, failures never throw", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, auth: init.headers.Authorization });
    if (url === config.tokenUrl) return response(200, { access_token: "tok" });
    if (url.includes("/matches/byContent")) {
      return response(200, {
        matches: [
          { manifestId: "other", endpoint: "https://other-registry.example/v1", similarityScore: 90 },
          { manifestId: "internal", endpoint: "https://169.254.169.254/latest", similarityScore: 90 },
        ],
      });
    }
    return response(200, CAMERA_MANIFEST, "application/c2pa");
  };
  const errors = [];
  const outcome = await c2pa.lookupContentCredentials(config, Uint8Array.from([1]), "image/jpeg", { fetchImpl, onError: (error) => errors.push(error.message) });
  const manifestCalls = sent.filter((call) => call.url.includes("/manifests/"));
  assert.equal(manifestCalls.length, 1, "the private-address endpoint is never fetched");
  assert.equal(manifestCalls[0].auth, undefined, "no token to another registry");
  assert.match(errors[0], /not a public https URL/);
  assert.equal(outcome.status, "checked");

  const down = await c2pa.lookupContentCredentials(config, Uint8Array.from([1]), "image/jpeg", { fetchImpl: async () => response(500, {}) });
  assert.deepEqual(down, { status: "unavailable" });
  const unsupported = await c2pa.lookupContentCredentials({ baseUrl: "https://c2pa.trufo.ai/v1" }, Uint8Array.from([1]), "application/pdf", { fetchImpl: async () => response(415, {}) });
  assert.deepEqual(unsupported, { status: "unsupported_file" });
  assert.deepEqual(await c2pa.lookupContentCredentials(null, Uint8Array.from([1]), "image/jpeg"), { status: "not_configured" });
});

test("pipeline: a registry AI match rejects an otherwise clean document", async () => {
  const fields = {
    documentType: "national_id", issuingCountry: "KEN", documentNumber: "12345678", surname: "WANJIRU", givenNames: "JANE",
    fullName: "Jane Wanjiru", dateOfBirth: "1990-01-01", sex: "F", nationality: "KEN", placeOfBirth: null, issueDate: "2020-01-01",
    expiryDate: "2030-01-01", issuingAuthority: null, address: null, personalNumber: null, mrzLines: [], hasFacePhoto: true, hasSignature: true,
  };
  const client = { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { isIdentityDocument: true, fields, fraud: { signals: [], summary: "" } } }) } } };
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const now = Date.parse("2026-10-14T00:00:00Z");
  const lookups = [];
  const contentCredentials = async (bytes, mediaType) => {
    lookups.push(mediaType);
    return { status: "checked", matches: 1, findings: [{ manifestId: "m", similarityScore: 97, digitalSourceType: "ai_generated", claimGenerator: "Adobe Firefly", edited: false }], flags: c2pa.c2paFlags([{ manifestId: "m", similarityScore: 97, digitalSourceType: "ai_generated", claimGenerator: "Adobe Firefly", edited: false }]) };
  };
  const result = await pipeline.runDocumentPipeline({ documentKind: "identity", front: jpeg, expected: {}, now }, { client, ocr: null, contentCredentials });
  assert.deepEqual(lookups, ["image/jpeg"]);
  assert.equal(result.verdict, "reject");
  assert.equal(result.contentCredentials.status, "checked");
  assert.equal(result.checks.find((check) => check.name.startsWith("No AI or edit record")).status, "failed");

  const without = await pipeline.runDocumentPipeline({ documentKind: "identity", front: jpeg, expected: {}, now }, { client, ocr: null });
  assert.equal(without.contentCredentials.status, "not_configured");
  assert.equal(without.verdict, "pass");
});
