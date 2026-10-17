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

const fm = loadTs("backend/convex/lib/faceMatch.ts");

const completed = (overrides = {}) => ({ status: "completed", probe: "selfie", outcome: "match", similarity: 98.2, message: fm.FACE_MATCH_MESSAGES.match, duplicateSearch: false, duplicates: [], ...overrides });

test("outcomes: 90% or more is a match, 70-90 unclear, below 70 no match, and missing faces", () => {
  assert.equal(fm.faceMatchOutcome({ probeFace: true, documentFace: true, similarity: 99 }), "match");
  assert.equal(fm.faceMatchOutcome({ probeFace: true, documentFace: true, similarity: 90 }), "match");
  assert.equal(fm.faceMatchOutcome({ probeFace: true, documentFace: true, similarity: 82 }), "uncertain");
  assert.equal(fm.faceMatchOutcome({ probeFace: true, documentFace: true, similarity: 12 }), "mismatch");
  assert.equal(fm.faceMatchOutcome({ probeFace: false, documentFace: true, similarity: null }), "no_face_selfie");
  assert.equal(fm.faceMatchOutcome({ probeFace: true, documentFace: false, similarity: null }), "no_face_document");
});

test("only a clear match without a duplicate leaves the verdict alone", () => {
  assert.equal(fm.faceMatchReview(completed()), null);
  assert.match(fm.faceMatchReview(completed({ outcome: "mismatch", similarity: 20, message: fm.FACE_MATCH_MESSAGES.mismatch })), /^Face match: The selfie doesn't match the photo on the ID\./);
  const duplicate = completed({ duplicateSearch: true, duplicates: [{ reference: "VER-1", similarity: 99, sameIdentity: false, createdAt: 1 }] });
  assert.match(fm.faceMatchReview(duplicate), /The same face is on another customer verified under a different identity \(VER-1\)/);
  const returning = completed({ duplicateSearch: true, duplicates: [{ reference: "VER-2", similarity: 99, sameIdentity: true, createdAt: 1 }] });
  assert.equal(fm.faceMatchReview(returning), null, "a returning customer isn't a signal");
});

test("duplicates: the same ID number (or name, without one) is the same identity", () => {
  const [same, other, byName] = fm.assessDuplicates({ idNumber: "1234-5678", name: "John Kamau" }, [
    { reference: "A", similarity: 99.44, idNumber: "12345678", name: "Peter Otieno", createdAt: 1 },
    { reference: "B", similarity: 97, idNumber: "87654321", name: "John Kamau", createdAt: 2 },
    { reference: "C", similarity: 96, idNumber: null, name: "Kamau John", createdAt: 3 },
  ]);
  assert.equal(same.sameIdentity, true);
  assert.equal(same.similarity, 99.4);
  assert.equal(other.sameIdentity, false, "same name, different ID number: two identities");
  assert.equal(byName.sameIdentity, true);
});

test("images: the first liveness JPEG, and only JPEG or PNG up to 5 MB", () => {
  const two = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9, 0xff, 0xd8, 3, 0xff, 0xd9]);
  assert.deepEqual([...fm.firstJpeg(two)], [0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  assert.equal(fm.firstJpeg(new Uint8Array([0, 0, 0, 0])), null, "an mp4 or other file");
  assert.equal(fm.isRekognitionImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])), true);
  assert.equal(fm.isRekognitionImage(new Uint8Array([0x25, 0x50, 0x44, 0x46])), false, "a PDF");
  assert.equal(fm.collectionIdFor("k57abc"), "sentinel-k57abc");
});

test("the report wording", () => {
  assert.equal(fm.describeFaceMatch(undefined), null);
  assert.equal(fm.describeFaceMatch(completed()).result, "Match");
  assert.equal(fm.describeFaceMatch(completed()).tone, "green");
  assert.equal(fm.describeFaceMatch({ status: "not_configured" }).result, "Not set up");
  assert.equal(fm.describeFaceMatch({ error: "face_match_unavailable" }).result, "Error");
  const dup = fm.describeFaceMatch(completed({ duplicateSearch: true, duplicates: [{ reference: "VER-9", similarity: 99, sameIdentity: false, createdAt: 1 }] }));
  assert.equal(dup.result, "Duplicate face");
  assert.equal(dup.tone, "red");
  assert.match(dup.detail, /VER-9 \(99%\)/);
});

test("wiring: KYC flow, settings, privacy and retention", () => {
  const idp = read("backend/convex/idp.ts");
  assert.match(idp, /if \(verdict !== "reject"\) \{\s*const faceMatch: FaceMatchStep = await ctx\.runAction\(internalApi\.faceMatchNode\.run/);
  assert.match(idp, /livenessFramesBase64: args\.livenessMediaType === "jpeg_frames"/);
  const node = read("backend/convex/faceMatchNode.ts");
  assert.match(node, /^"use node";/);
  assert.match(node, /if \(!client\) return \{ status: "not_configured" \}/);
  assert.match(node, /AccessDeniedException/);
  assert.match(node, /if \(settings\.duplicateFaceSearch && probeFace\)/);
  assert.match(node, /ExternalImageId: args\.verificationId/);
  assert.match(read("backend/convex/faceMatch.ts"), /if \(!row \|\| row\.clientId !== args\.clientId\) continue;/, "another client's check is never returned");
  assert.match(read("backend/convex/retention.ts"), /removed \+= await purgeFaces\(ctx, verification\._id\)/);
  const settings = read("backend/convex/lib/clientSettings.ts");
  assert.match(settings, /faceMatch: true,\r?\n\s*duplicateFaceSearch: false,/);
  assert.match(read("app/(platform)/settings/screening/screening-settings.tsx"), /label="Search for the same face among your customers"/);
  assert.match(read("components/reports/kyc-report-spec.ts"), /steps\.splice\(2, 0, \{ name: "Face match", \.\.\.face \}\)/);
});
