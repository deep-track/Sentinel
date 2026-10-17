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
    return loadTs(path.relative(root, `${resolved}.ts`), cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const ai = loadTs("backend/convex/lib/aiHitReview.ts");

const subject = { name: "Mohamed Hassan Abdi", entityType: "individual", dateOfBirth: "1991-04-02", nationality: "KE", country: "KE", idNumber: "29384756" };
const sanctionsHit = { source: "OPENSANCTIONS", sourceRecordId: "Q1", name: "Mohammed Hassan Abdi", categories: ["sanctions"], matchScore: 91, birthDateCheck: "differs from the customer", listed: { birthDates: ["1968"], nationalities: ["so"], countries: ["so"], aliases: [], idNumbers: [], gender: "male", notes: [] } };
const pepHit = { source: "OPENSANCTIONS", sourceRecordId: "Q2", name: "Mohamed Abdi", categories: ["pep"], pepClass: 2, matchScore: 80 };

test("the prompt carries the evidence but never an ID number", () => {
  const prompt = ai.buildPrompt(subject, [{ ...sanctionsHit, idNumberCheck: ai.compareIdNumbers(subject.idNumber, ["12345678"]) }]);
  assert.match(prompt, /Date of birth: 1991-04-02/);
  assert.match(prompt, /Listed dates of birth: 1968/);
  assert.match(prompt, /ID number check: differs from the listed ID numbers/);
  assert.match(prompt, /ID \/ passport number: provided/);
  assert.doesNotMatch(prompt, /29384756|12345678/);
  assert.equal(ai.compareIdNumbers("2938-4756", ["29384756"]), "matches a listed ID number");
  assert.equal(ai.compareIdNumbers(null, ["1"]), null);
});

const raw = (recommendation, hits, confidence = "high") => ({ recommendation, confidence, summary: "Summary.", hits });
const hit = (index, assessment, confidence = "high") => ({ index, assessment, confidence, reasons: ["Born 1991 vs 1968."], missingInformation: [] });

test("safety rules: a same-person hit confirms; anything not shown to be different escalates", () => {
  const confirmed = ai.applyGuardrails(raw("clear", [hit(0, "same_person"), hit(1, "different_person")]), [sanctionsHit, pepHit]);
  assert.equal(confirmed.recommendation, "confirm");
  assert.ok(confirmed.guardrail);

  const unclear = ai.applyGuardrails(raw("clear", [hit(0, "different_person")]), [sanctionsHit, pepHit]);
  assert.equal(unclear.recommendation, "escalate", "an unassessed hit is unclear");
  assert.equal(unclear.hits[1].assessment, "unclear");

  const lowSanctions = ai.applyGuardrails(raw("clear", [hit(0, "different_person", "low"), hit(1, "different_person")]), [sanctionsHit, pepHit]);
  assert.equal(lowSanctions.recommendation, "escalate");

  const clear = ai.applyGuardrails(raw("clear", [hit(0, "different_person"), hit(1, "different_person", "medium")]), [sanctionsHit, pepHit]);
  assert.equal(clear.recommendation, "clear");
  assert.equal(clear.guardrail, null);
  assert.equal(clear.hits[0].name, "Mohammed Hassan Abdi");
});

test("the request: Opus 5.5, structured output, fallbacks, the analyst system prompt", async () => {
  const calls = [];
  const client = {
    beta: {
      messages: {
        parse: async (request) => {
          calls.push(request);
          return { stop_reason: "end_turn", parsed_output: raw("clear", [hit(0, "different_person"), hit(1, "different_person")]) };
        },
      },
    },
  };
  const result = await ai.assessHits(client, subject, [sanctionsHit, pepHit]);
  assert.equal(result.recommendation, "clear");
  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.equal(calls[0].output_config.format.type, "json_schema");
  assert.equal(calls[0].fallbacks, "default");
  assert.match(calls[0].system, /East African names/);
  const refused = { beta: { messages: { parse: async () => ({ stop_reason: "refusal", parsed_output: null }) } } };
  await assert.rejects(ai.assessHits(refused, subject, [pepHit]), /declined/);
});

test("OpenSanctions profiles give the details that tell people apart", () => {
  const details = ai.listedDetails({ properties: { birthDate: ["1968-01-01"], nationality: ["so"], alias: ["Maxamed Xasan"], passportNumber: ["P123"], gender: ["male"], notes: ["Listed 2010."] } });
  assert.deepEqual(details.birthDates, ["1968-01-01"]);
  assert.deepEqual(details.nationalities, ["so"]);
  assert.deepEqual(details.idNumbers, ["P123"]);
  assert.equal(details.gender, "male");
});

test("wiring: runs when an AML case opens (setting on by default), on request, and shows on the case", () => {
  assert.match(read("backend/convex/clientReviews.ts"), /await scheduleHitReview\(ctx, reviewId, verification, settings\.screening\.aiHitReview\)/);
  assert.match(read("backend/convex/lib/clientSettings.ts"), /aiHitReview: true,/);
  const module = read("backend/convex/aiHitReview.ts");
  assert.match(module, /verification\?\.type === "aml"/);
  assert.match(module, /listed: listed \? \{ \.\.\.listed, idNumbers: \[\] \} : null/, "listed ID numbers are dropped before the prompt");
  assert.match(read("app/(platform)/reviews/[id]/review-case.tsx"), /<AiAssessmentPanel/);
  assert.match(read("app/(platform)/settings/screening/screening-settings.tsx"), /AI hit review/);
});
