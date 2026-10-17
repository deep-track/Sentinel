const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Loads the module with stubbed Convex imports, for its pure helpers.
function load() {
  const { outputText } = ts.transpileModule(read("backend/convex/videoNarration.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const stubs = { "convex/values": { ConvexError: Error, v: new Proxy({}, { get: () => () => ({}) }) }, "./_generated/server": { internalAction: (definition) => definition } };
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, (name) => stubs[name] ?? require(name), module);
  return module.exports;
}

const { captionCues } = load();

const align = (text, secondsPerChar = 0.05) => {
  const characters = [...text];
  return { characters, character_start_times_seconds: characters.map((_, i) => i * secondsPerChar), character_end_times_seconds: characters.map((_, i) => (i + 1) * secondsPerChar) };
};

test("captions: a few words per cue, split at sentence ends, offset by earlier scenes", () => {
  const text = "Open Reviews. The PEP case is first in the queue, with the AI recommendation beside it.";
  const cues = captionCues(text, align(text), 10);
  assert.equal(cues[0].text, "Open Reviews.");
  assert.ok(cues.every((cue) => cue.text.split(" ").length <= 9));
  assert.equal(cues.map((cue) => cue.text).join(" "), text);
  assert.ok(cues[0].start >= 10, "offset applied");
  assert.ok(cues.every((cue, i) => i === 0 || cue.start >= cues[i - 1].end - 1e-9), "in order");
  assert.deepEqual(captionCues(text, null, 0), []);
});

test("wiring: internal only, the key from Convex env, timestamps endpoint, audio stored", () => {
  const source = read("backend/convex/videoNarration.ts");
  assert.doesNotMatch(source, /export const \w+ = (action|mutation|query)\(/, "nothing public");
  assert.match(source, /process\.env\.ELEVENLABS_API_KEY/);
  assert.match(source, /\/with-timestamps\?output_format=mp3_44100_128/);
  assert.match(source, /ctx\.storage\.store\(new Blob/);
  assert.match(source, /\/v1\/shared-voices\?/, "the Voice Library search");
});
