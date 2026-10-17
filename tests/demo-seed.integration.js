const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const seed = read("backend/convex/demoSeed.ts");

test("the demo seed is internal, confirmed by name and created once", () => {
  assert.match(seed, /export const seed = internalAction\(/);
  assert.match(seed, /export const reset = internalMutation\(/);
  assert.match(seed, /const confirm = v\.literal\(DEMO_NAME\);/);
  assert.match(seed, /if \(existing\) throw new ConvexError\(\{ code: "exists"/);
  assert.match(seed, /isDemo: true,/);
  assert.match(read("backend/convex/schema.ts"), /isDemo: v\.optional\(v\.boolean\(\)\),/);
});

test("reset only ever touches the client marked isDemo", () => {
  const reset = seed.slice(seed.indexOf("export const reset"));
  assert.match(reset, /\.find\(\(row\) => row\.isDemo\)/);
  assert.match(reset, /if \(!client\) return \{ done: true, removed: 0 \}/);
  assert.doesNotMatch(reset, /query\("clients"\)[\s\S]*?delete\(row\._id\)[\s\S]*?query\("clients"\)/, "never deletes other clients");
});

test("nothing is charged and no provider is called", () => {
  assert.doesNotMatch(seed, /chargeReason/);
  assert.match(seed, /chargeCredits: false/);
  assert.doesNotMatch(seed, /screenSubjects|runDocumentPipeline|fetch\(/);
  assert.match(seed, /creditsUsed: 0/);
});

test("every manual scenario is seeded", () => {
  for (const key of ["kycPass", "kycMismatch", "kycFake", "docKenyanId", "docMaisha", "docAiId", "docKraOk", "docKraUnknown", "amlPep", "amlSanctions", "kyb", "kycNetwork"]) {
    assert.match(seed, new RegExp(`"${key}"`), key);
  }
  for (const marker of ["amlMonitoredSubjects", "strReports", "client_dispute", "captureSessions", "sanctioned_counterparty", "CUST-2077"]) {
    assert.ok(seed.includes(marker), marker);
  }
});

test("the fraud network example reuses James Mutua's ID with another person", () => {
  const example = seed.match(/const NETWORK_EXAMPLE = \{([^}]*)\}/);
  assert.ok(example, "NETWORK_EXAMPLE");
  assert.match(example[1], /idNumber: "27650431"/);
  assert.match(seed, /kyc\("kycFake", \{[^}]*idNumber: "27650431"/);
  assert.doesNotMatch(example[1], /Mutua|1989-06-15/);
  // Completed as a pass through the real completion code, so the network decides.
  assert.match(seed, /id: ids\.kycNetwork, verdict: "pass"/);
});

test("the example can be added to an existing Demo Bank once, without a reset", () => {
  const add = seed.slice(seed.indexOf("export const addFraudNetworkExample"), seed.indexOf("// ── Reset"));
  assert.match(add, /args: \{ confirm \}/);
  assert.match(add, /if \(state\.exists\) return \{ added: false/);
  assert.match(add, /verifications\._complete/);
  assert.doesNotMatch(add, /chargeReason|fetch\(/);
});
