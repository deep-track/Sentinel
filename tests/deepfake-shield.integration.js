const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative) {
  const { outputText } = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative });
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, require, module);
  return module.exports;
}

const shield = loadTs("backend/convex/lib/deepfakeShield.ts");
const real = { provider: "deeptrack_live", prediction: "real", confidencePct: 96, fakeProbability: 0.04, warning: null };
const fake = { ...real, prediction: "fake", confidencePct: 93 };

test("KYC: the DeepTrack Live selfie check, liveness and the document forgery score", () => {
  const clean = shield.deepfakeShield("idp", { faceCheck: real, liveness: { livenessScore: 0.97, deepfakeFlag: false, confidence: 0.9 }, docScan: { fakeScore: 0.05, flags: [] } });
  assert.equal(clean.status, "clear");
  assert.equal(clean.headline, "No deepfake or AI forgery detected");
  assert.deepEqual(clean.checks.map((check) => check.outcome), ["clear", "clear", "clear"]);

  const caught = shield.deepfakeShield("idp", { faceCheck: fake, liveness: { status: "not_collected" } });
  assert.equal(caught.status, "detected");
  assert.match(caught.checks[0].detail, /Fake or synthetic face \(93% confidence\)/);
  assert.equal(caught.checks[0].by, "DeepTrack Live");

  assert.equal(shield.deepfakeShield("idp", { liveness: { livenessScore: 0.9, deepfakeFlag: true, confidence: 0.9 } }).status, "detected");
  assert.equal(shield.deepfakeShield("idp", { faceCheck: { ...real, confidencePct: 55 } }).status, "uncertain", "a weak 'real' isn't clear");
  assert.equal(shield.deepfakeShield("idp", { faceCheck: { error: "upstream_unavailable" } }).status, "not_checked");
});

test("documents: AI-generated, edited and photo-substituted documents", () => {
  const clean = shield.deepfakeShield("document", { flags: [{ code: "document_expired", message: "Expired." }] });
  assert.equal(clean.status, "clear", "an expired document isn't a forgery");
  const ai = shield.deepfakeShield("document", { flags: [{ code: "visual_ai_generated", message: "Looks AI-generated: warped guilloche." }] });
  assert.equal(ai.status, "detected");
  assert.equal(ai.checks.find((check) => check.name === "AI-generated document").outcome, "flagged");
  assert.equal(shield.deepfakeShield("document", { flags: [{ code: "c2pa_ai_generated" }] }).status, "detected");
  assert.equal(shield.deepfakeShield("document", { flags: [{ code: "edited_with_software" }] }).checks[1].outcome, "flagged");
});

test("not applicable: AML, KYB, sandbox results", () => {
  assert.equal(shield.deepfakeShield("aml", { matches: [] }), null);
  assert.equal(shield.deepfakeShield("kyb", {}), null);
  assert.equal(shield.deepfakeShield("document", { sandbox: true }), null);
  assert.equal(shield.deepfakeShield("idp", null), null);
});

test("wiring: reports, PDFs and the dashboard", () => {
  assert.match(read("app/(platform)/kyc/[id]/page.tsx"), /deepfakeShield\("idp", record\.result\)/);
  assert.match(read("app/(platform)/idp/[id]/document-report.tsx"), /deepfakeShield\("document", result\)/);
  assert.match(read("components/reports/kyc-report-spec.ts"), /shieldSection\(shield\)/);
  assert.match(read("components/reports/document-report-spec.ts"), /shieldSection\(shield\)/);
  assert.match(read("backend/convex/dashboard.ts"), /deepfakes: v\.optional\(v\.object\(\{ detected: v\.number\(\), checked: v\.number\(\) \}\)\)/);
  assert.match(read("app/(platform)/dashboard/page.tsx"), /<DeepfakeTile/);
});
