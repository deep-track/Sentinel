const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// lib/deeptrackLive.ts has no imports, so transpiling it to CommonJS and
// evaluating it is enough to exercise the real implementation.
function loadTs(file) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", outputText)(mod.exports, require, mod);
  return mod.exports;
}

const live = loadTs("backend/convex/lib/deeptrackLive.ts");

// Shape returned by POST /v1/image/predict (as read by the deeptrack SDK).
const realResponse = { prediction: "Real", confidence_percentage: 96.4, raw_scores: { Real: 0.964, Fake: 0.036 } };

test("parses a DeepTrack Live image prediction", () => {
  assert.deepEqual(live.parseDeeptrackLiveImageResponse(realResponse), {
    provider: "deeptrack_live",
    prediction: "real",
    confidencePct: 96.4,
    fakeProbability: 0.036,
    warning: null,
  });
  const warned = live.parseDeeptrackLiveImageResponse({ ...realResponse, warning: " Low light " });
  assert.equal(warned.warning, "Low light");
});

test("rejects unrecognised DeepTrack Live responses", () => {
  const parse = live.parseDeeptrackLiveImageResponse;
  assert.equal(parse(null), null);
  assert.equal(parse([]), null);
  assert.equal(parse({ prediction: "maybe", confidence_percentage: 50 }), null);
  assert.equal(parse({ prediction: "real" }), null);
  assert.equal(parse({ prediction: "real", confidence_percentage: 140 }), null);
  assert.equal(parse({ prediction: "real", confidence_percentage: "90" }), null);
  // A malformed raw score is dropped, not trusted.
  assert.equal(parse({ prediction: "fake", confidence_percentage: 91, raw_scores: { Fake: 3 } }).fakeProbability, null);
});

test("face check decision: confident fake rejects, clean real clears, everything else reviews", () => {
  const decide = (prediction, confidencePct, warning = null) =>
    live.faceCheckDecision({ provider: "deeptrack_live", prediction, confidencePct, fakeProbability: null, warning });
  assert.equal(decide("fake", 90), "reject");
  assert.equal(decide("fake", 99.9), "reject");
  assert.equal(decide("fake", 89.9), "review");
  assert.equal(decide("uncertain", 99), "review");
  assert.equal(decide("real", 70), "clear");
  assert.equal(decide("real", 69.9), "review");
  assert.equal(decide("real", 98, "Low image quality"), "review");
});

test("decodes JPEG, PNG and WebP selfies and refuses anything else", () => {
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const jpeg = live.decodeSelfieImage(b64([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.equal(jpeg.bytes.length, 6);
  assert.equal(live.decodeSelfieImage(`data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])}`).mimeType, "image/png");
  assert.equal(live.decodeSelfieImage(b64([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))))).mimeType, "image/webp");
  assert.equal(live.decodeSelfieImage(b64([0x25, 0x50, 0x44, 0x46])), null, "PDF is not a selfie");
  assert.equal(live.decodeSelfieImage("!!not base64!!"), null);
});

test("risk engine: a confident fake rejects before infrastructure failures, errors review", () => {
  const engine = read("backend/convex/lib/riskEngine.ts");
  const rejectAt = engine.indexOf('faceCheckDecision(faceCheckResult) === "reject"');
  const infraAt = engine.indexOf('"Scan service infrastructure failure"');
  assert.ok(rejectAt > 0 && infraAt > rejectAt, "fake-face reject is checked before the infrastructure-failure review");
  assert.match(engine, /faceCheckErrored/);
  assert.match(engine, /faceCheckDecision\(faceCheckResult\) === "review"/);
});

test("a clean selfie never stands in for liveness", () => {
  const idp = read("backend/convex/idp.ts");
  assert.match(idp, /const livenessCollected = Boolean\(args\.livenessFramesBase64 && args\.livenessMediaType\)/);
  assert.match(idp, /!livenessCollected && REQUIRE_LIVENESS_FOR_AUTO_PASS/);
});

test("KYC forwards the selfie to the scan without storing it", () => {
  const verifications = read("backend/convex/verifications.ts");
  assert.match(verifications, /selfieBase64: args\.selfieBase64,\r?\n\s+actor:/);
  assert.match(verifications, /selfieBase64: params\.selfieBase64,/);
  assert.doesNotMatch(verifications, /storedExtras: \{[^}]*selfieBase64/);
});

test("face check client sends X-API-Key and fails closed without a key", () => {
  const client = read("backend/convex/lib/awsClients/faceCheckClient.ts");
  assert.match(client, /"X-API-Key": apiKey/);
  assert.match(client, /DEEPTRACK_LIVE_API_KEY/);
  assert.match(client, /upstream_misconfigured/);
  assert.match(client, /form\.append\("file"/);
});

test("DeepTrack Live has no default service URL", () => {
  assert.equal(live.DEEPTRACK_LIVE_DEFAULT_BASE_URL, undefined);
  const client = read("backend/convex/lib/awsClients/faceCheckClient.ts");
  assert.match(client, /Missing required env var DEEPTRACK_LIVE_BASE_URL/);
  const health = read("backend/convex/backOfficeHealth.ts");
  assert.match(health, /error: "DEEPTRACK_LIVE_BASE_URL is not set"/);
  assert.match(health, /key: "DEEPTRACK_LIVE_BASE_URL", label: "DeepTrack Live URL"/);
  for (const file of ["backend/convex/lib/deeptrackLive.ts", "backend/convex/lib/awsClients/faceCheckClient.ts", "backend/convex/backOfficeHealth.ts"]) {
    assert.doesNotMatch(read(file), /onrender\.com/, file);
  }
});
