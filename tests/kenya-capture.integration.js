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

const capture = loadTs("backend/convex/lib/capture.ts");

test("links: 64-hex tokens under /verify, valid for 72 hours", () => {
  assert.equal(capture.captureLink("https://sentinel.deeptrack.io/", "ab".repeat(32)), `https://sentinel.deeptrack.io/verify/${"ab".repeat(32)}`);
  assert.equal(capture.isCaptureToken("ab".repeat(32)), true);
  assert.equal(capture.isCaptureToken("../../etc"), false);
  assert.equal(capture.CAPTURE_LINK_HOURS, 72);
  const now = 1_000_000;
  assert.equal(capture.effectiveStatus({ status: "pending", expiresAt: now - 1 }, now), "expired");
  assert.equal(capture.effectiveStatus({ status: "opened", expiresAt: now + 1 }, now), "opened");
  assert.equal(capture.effectiveStatus({ status: "submitted", expiresAt: now - 1 }, now), "submitted", "a used link stays used");
});

test("messages in English and Swahili name the client and the link", () => {
  assert.match(capture.captureMessage("en", "Acme Bank", "https://x/verify/t"), /^Acme Bank asks you to verify your identity\. .*72 hours: https:\/\/x\/verify\/t$/);
  assert.match(capture.captureMessage("sw", "Acme Bank", "https://x/verify/t"), /^Acme Bank inakuomba uthibitishe utambulisho wako\. .*saa 72: https:\/\/x\/verify\/t$/);
});

test("the customer is only asked for the details the client didn't prefill", () => {
  assert.deepEqual(capture.missingDetails({}), ["firstName", "lastName", "idNumber", "dateOfBirth", "gender"]);
  assert.deepEqual(capture.missingDetails({ firstName: "John", lastName: "Kamau", idNumber: "12345678", dateOfBirth: "1990-01-01", gender: " " }), ["gender"]);
});

test("every screen has both languages", () => {
  const keys = (object) => Object.keys(object).sort();
  assert.deepEqual(keys(capture.CAPTURE_TEXT.sw), keys(capture.CAPTURE_TEXT.en));
  assert.match(capture.CAPTURE_TEXT.en.consent("Acme"), /Kenya Data Protection Act, 2019/);
  assert.match(capture.CAPTURE_TEXT.sw.consent("Acme"), /Sheria ya Ulinzi wa Data ya Kenya, 2019/);
});

test("wiring: public page, token hashing, one use, billing as KYC, privacy", () => {
  assert.match(read("middleware.ts"), /const PUBLIC_ROUTES = \["\/sign-in", "\/logged-out", "\/signup", "\/verify"\]/);
  const backend = read("backend/convex/capture.ts");
  assert.match(backend, /tokenHash: await sha256Hex\(token\)/);
  assert.doesNotMatch(read("backend/convex/schema.ts").match(/captureSessions: defineTable\([\s\S]*?\}\)/)[0], /^\s*token:/m, "the token itself is never stored");
  assert.match(backend, /if \(status !== "pending" && status !== "opened"\) throw/);
  assert.match(backend, /consent: v\.literal\(true\)/);
  assert.match(backend, /await createIdpVerification\(ctx, \{/);
  assert.match(backend, /prefill: \{\} \}\);/, "prefilled details are cleared once submitted");
  assert.match(backend, /captureSubmitPerLink/);
  assert.match(backend, /idNumber: [^\n]*\n?/);
  assert.doesNotMatch(backend.match(/export const session = query\([\s\S]*?\n\}\);/)[0], /idNumber: row/, "the public page never gets the ID number");
  assert.match(read("backend/convex/crons.ts"), /capture\.expireStale/);
  const flow = read("app/verify/[token]/capture-flow.tsx");
  assert.match(flow, /capture=\{facing\}/);
  assert.match(flow, /const MAX_BASE64 = 900_000;/);
  assert.match(read("app/(platform)/kyc/page.tsx"), /href="\/kyc\/capture"/);
});
