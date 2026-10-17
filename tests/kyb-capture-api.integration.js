const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const http = read("backend/convex/http.ts");
const kyb = read("backend/convex/kyb.ts");
const capture = read("backend/convex/capture.ts");
const apiKeys = read("backend/convex/apiKeys.ts");

test("the new routes exist behind API keys and their own scopes", () => {
  for (const route of ["POST /v1/verify/kyb", "POST /v1/capture-links", "GET /v1/capture-links", "GET /v1/capture-links/*", "DELETE /v1/capture-links/*"]) {
    assert.ok(http.includes(`apiAction("${route}"`), route);
  }
  assert.match(apiKeys, /"verify:kyb", "capture"/);
  assert.match(apiKeys, /if \(route === "POST \/v1\/verify\/kyb"\) return "verify:kyb";/);
  assert.match(apiKeys, /if \(route\.includes\("\/v1\/capture-links"\)\) return "capture";/);
});

test("KYB: the dashboard and the API share one creation path", () => {
  assert.match(kyb, /async function createKybVerification\(/);
  const dashboard = kyb.slice(kyb.indexOf("export const createKyb"), kyb.indexOf("export const _createFromApi"));
  assert.match(dashboard, /createKybVerification\(ctx/);
  const api = kyb.slice(kyb.indexOf("export const _createFromApi"), kyb.indexOf("export const _discardFiles"));
  assert.match(api, /createKybVerification\(ctx/);
  assert.match(api, /actorType: "client_api_key"/);
  // Test keys: a sandbox pass, nothing processed or charged, files deleted.
  assert.match(api, /environment === "test"[\s\S]*?ctx\.storage\.delete\(registrationDocStorageId\)[\s\S]*?creditsUsed: 0[\s\S]*?sandbox: true/);
});

test("KYB: files are checked, stored, and dropped when the check is refused", () => {
  assert.match(http, /const KYB_MAX_FILE_BASE64_CHARS = 4_000_000;/);
  assert.match(http, /function knownFileType\(bytes: Uint8Array\): boolean/);
  assert.match(http, /ctx\.storage\.store\(new Blob\(\[registrationDoc\]\)\)/);
  const route = http.slice(http.indexOf('apiAction("POST /v1/verify/kyb"'), http.indexOf("function kybSummary"));
  assert.match(route, /if \(!created\) await discard\(\);\s*return response;/);
  assert.match(route, /catch \(error\) \{\s*if \(!created\) await discard\(\);\s*throw error;/);
});

test("KYB: the pipeline reads API files from storage and retention deletes them", () => {
  const node = read("backend/convex/kybNode.ts");
  assert.match(node, /async function loadDocument\(ctx: ActionCtx, url: string \| undefined, storageId: Id<"_storage"> \| undefined\)/);
  assert.match(node, /loadDocument\(ctx, input\.registrationDocUrl, input\.registrationDocStorageId\)/);
  assert.match(node, /loadDocument\(ctx, input\.proofOfAddressUrl, input\.proofOfAddressStorageId\)/);
  const retention = read("backend/convex/retention.ts");
  assert.match(retention, /for \(const key of \["registrationDocStorageId", "proofOfAddressStorageId"\]\)/);
  assert.match(retention, /ctx\.storage\.delete\(id\)/);
  // The report links to them, for members of the client only.
  assert.match(kyb, /export const documentLinks = query\(/);
  assert.match(kyb, /canReadClient\(ctx, row\.clientId\)/);
  assert.match(read("app/(platform)/kyb/[id]/page.tsx"), /anyApi\.kyb\.documentLinks/);
});

test("KYB results are summarised for GET /v1/verify/{id}", () => {
  assert.match(http, /record\.type === "kyb" && record\.status === "completed" \? \{ kyb: kybSummary\(record\.result\) \}/);
});

test("capture links: one creation path, a public id, and nothing secret in the API view", () => {
  assert.match(capture, /async function createLink\(ctx: MutationCtx, args: CreateArgs\)/);
  assert.match(capture, /const reference = `cap_\$\{randomKeySegment\(16\)\}`;/);
  const dashboard = capture.slice(capture.indexOf("export const create = mutation"), capture.indexOf("// -- The capture links API"));
  assert.match(dashboard, /createLink\(ctx/);
  const view = capture.slice(capture.indexOf("async function apiView"), capture.indexOf("const methodValidator"));
  assert.doesNotMatch(view, /tokenHash|prefill|idNumber|dateOfBirth/);
  assert.match(read("backend/convex/schema.ts"), /\.index\("by_client_and_reference", \["clientId", "reference"\]\)/);
});

test("capture links: test keys store and send nothing; cancel only stops live links", () => {
  const api = capture.slice(capture.indexOf("export const _createFromApi"), capture.indexOf("async function byReference"));
  const sandbox = api.slice(api.indexOf('environment === "test"'), api.indexOf("const created = await createLink"));
  assert.doesNotMatch(sandbox, /ctx\.db\.insert|scheduler/);
  assert.match(sandbox, /link: null/);
  const cancel = capture.slice(capture.indexOf("export const _cancelFromApi"));
  assert.match(cancel, /if \(status === "pending" \|\| status === "opened"\)/);
  assert.match(cancel, /prefill: \{\}/);
});

test("the developer manual documents both APIs", () => {
  const chapter = read("content/help/c/c8-kyb-and-capture-links-api.md");
  for (const text of ["POST /v1/verify/kyb", "/v1/capture-links", "verify:kyb", "`capture`", "sandbox: true", "4,000,000"]) {
    assert.ok(chapter.includes(text), text);
  }
});
