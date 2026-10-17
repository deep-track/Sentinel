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

// Video job result, as read by the deeptrack SDK's VideoAnalyzer._parse_result.
const videoResult = { label: "REAL", confidence: 91.2, fake_prob: 0.088, face_pct: 97.5, total_frames: 150, n_segments: 3 };

test("parses a DeepTrack Live video result", () => {
  assert.deepEqual(live.parseDeeptrackLiveVideoResult(videoResult), {
    provider: "deeptrack_live",
    prediction: "real",
    confidencePct: 91.2,
    fakeProbability: 0.088,
    facePct: 97.5,
    totalFrames: 150,
    segments: 3,
  });
  const parse = live.parseDeeptrackLiveVideoResult;
  assert.equal(parse(null), null);
  assert.equal(parse({ ...videoResult, label: "maybe" }), null);
  assert.equal(parse({ ...videoResult, face_pct: undefined }), null, "face coverage is required");
  assert.equal(parse({ ...videoResult, n_segments: -1 }), null);
  assert.equal(parse({ ...videoResult, confidence: 120 }), null);
});

test("video job statuses: running, done, error and unrecognised", () => {
  const job = live.parseDeeptrackLiveVideoJob;
  assert.deepEqual(job({ status: "queued" }), { state: "pending" });
  assert.deepEqual(job({ status: "processing" }), { state: "pending" });
  assert.equal(job({ status: "done", result: videoResult }).state, "done");
  assert.deepEqual(job({ status: "done", result: null }), { state: "invalid" }, "done without a usable result is not a pass");
  assert.deepEqual(job({ status: "error", error: "decode failed" }), { state: "error" });
  assert.deepEqual(job({}), { state: "invalid" });
  assert.deepEqual(job("nope"), { state: "invalid" });
});

test("video decision: confident fake with a visible face rejects, clean real clears, the rest reviews", () => {
  const base = live.parseDeeptrackLiveVideoResult(videoResult);
  const decide = (overrides) => live.videoLivenessDecision({ ...base, ...overrides });
  assert.equal(decide({}), "clear");
  assert.equal(decide({ facePct: 79 }), "review", "face hidden too often");
  assert.equal(decide({ segments: 0 }), "review", "no pulse segment analysed");
  assert.equal(decide({ confidencePct: 60 }), "review");
  assert.equal(decide({ prediction: "uncertain" }), "review");
  assert.equal(decide({ prediction: "fake", confidencePct: 95 }), "reject");
  assert.equal(decide({ prediction: "fake", confidencePct: 95, facePct: 30 }), "review", "too little face to reject");
  assert.equal(decide({ prediction: "fake", confidencePct: 80 }), "review");
});

test("WebM recordings are uploaded as Matroska, MP4 as MP4", () => {
  assert.deepEqual(live.videoUploadName("mp4"), { fileName: "liveness.mp4", mimeType: "video/mp4" });
  assert.deepEqual(live.videoUploadName("webm"), { fileName: "liveness.mkv", mimeType: "video/x-matroska" });
});

const capture = loadTs("modules/shared/liveness-video.ts");

test("recorder prefers MP4 and falls back to WebM", () => {
  const supports = (types) => (mimeType) => types.includes(mimeType);
  assert.equal(capture.pickRecorderFormat(supports(["video/mp4", "video/webm"])).mediaType, "mp4");
  assert.equal(capture.pickRecorderFormat(supports(["video/webm;codecs=vp8"])).mimeType, "video/webm;codecs=vp8");
  assert.equal(capture.pickRecorderFormat(supports([])), null);
});

test("the clip fits the media limit at the chosen bitrate", () => {
  const expectedBytes = (capture.LIVENESS_VIDEO_BITS_PER_SECOND / 8) * capture.LIVENESS_CLIP_SECONDS;
  assert.ok(expectedBytes < capture.MAX_LIVENESS_VIDEO_BYTES, "nominal clip size stays under the limit");
  assert.ok(Math.ceil(capture.MAX_LIVENESS_VIDEO_BYTES / 3) * 4 <= 1_000_000, "limit encodes within MAX_MEDIA_BASE64_CHARS");
});

test("liveness video routes to DeepTrack Live and a video reject is decisive", () => {
  const client = read("backend/convex/lib/awsClients/livenessClient.ts");
  assert.match(client, /req\.mediaType === "mp4" \|\| req\.mediaType === "webm"/);
  assert.match(client, /if \(result\.decision !== undefined\) return result\.decision === "clear"/);
  const engine = read("backend/convex/lib/riskEngine.ts");
  assert.ok(engine.indexOf('livenessVerdict === "reject"') < engine.indexOf('"Scan service infrastructure failure"'));
  const wizard = read("modules/kyc/kyc-wizard.tsx");
  assert.match(wizard, /livenessFramesBase64: data\.livenessVideoBase64/);
  assert.doesNotMatch(wizard, /livenessFramesBase64: data\.selfieBase64/, "the still selfie is never sent as liveness");
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
