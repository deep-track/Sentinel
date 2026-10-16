import type Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";

// AI hit review (aiHitReview.ts): Claude compares the screened customer with
// each hit, the way a senior analyst would, and recommends clearing the
// hits, confirming the match or escalating. It only recommends: a person
// decides, under the client's four-eyes and clearance rules. Safety rules on
// top of the model: a sanctions hit is only "clear" when the evidence shows
// a different person; a hit judged the same person makes the overall
// recommendation "confirm".

export const AI_REVIEW_MODEL = "claude-opus-5-5";
export const MAX_HITS_REVIEWED = 15;

export type ReviewSubject = {
  name: string;
  entityType: "individual" | "entity";
  dateOfBirth?: string | null;
  nationality?: string | null;
  country?: string | null;
  idNumber?: string | null;
  registrationNumber?: string | null;
  aliases?: string[];
};

export type HitEvidence = {
  source: string;
  sourceRecordId: string;
  name: string;
  categories: string[];
  pepClass?: number | null;
  program?: string | null;
  matchScore?: number | null;
  matchMethod?: string | null;
  matchedCountry?: string | null;
  countryCheck?: string | null;
  birthDateCheck?: string | null;
  // Compared in code, so ID numbers never go to the model.
  idNumberCheck?: "matches a listed ID number" | "differs from the listed ID numbers" | null;
  topics?: string[];
  positions?: string[];
  media?: { title: string; domain: string | null; publishedAt: string | null; aboutSubject: string; summary: string } | null;
  // From the list's full record (OpenSanctions profile), when available.
  listed?: { birthDates: string[]; nationalities: string[]; countries: string[]; aliases: string[]; idNumbers: string[]; gender: string | null; notes: string[] } | null;
};

export type HitAssessment = {
  index: number;
  assessment: "same_person" | "different_person" | "unclear";
  confidence: "high" | "medium" | "low";
  reasons: string[];
  missingInformation: string[];
};

export type AiAssessment = {
  recommendation: "clear" | "confirm" | "escalate";
  confidence: "high" | "medium" | "low";
  summary: string;
  hits: Array<HitAssessment & { name: string; source: string; sourceRecordId: string }>;
  guardrail: string | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendation", "confidence", "summary", "hits"],
  properties: {
    recommendation: { type: "string", enum: ["clear", "confirm", "escalate"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string", description: "Two to four sentences for the case file." },
    hits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "assessment", "confidence", "reasons", "missingInformation"],
        properties: {
          index: { type: "integer" },
          assessment: { type: "string", enum: ["same_person", "different_person", "unclear"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasons: { type: "array", items: { type: "string" }, description: "Each reason cites the evidence it rests on." },
          missingInformation: { type: "array", items: { type: "string" }, description: "What would settle it (e.g. the customer's date of birth)." },
        },
      },
    },
  },
} as const;

export const SYSTEM_PROMPT = `You are a senior AML compliance analyst at a regulated East African financial institution, reviewing screening hits for one customer.

For each hit decide whether it is the same person or organisation as the customer:
- "different_person": the evidence shows a different subject, e.g. a date of birth years apart, a different gender, nationality and country both unrelated, an organisation vs a person, a listed person who died or is far too old or young, a news article about someone else.
- "same_person": identifiers agree beyond the name (date of birth, ID number, nationality with country, a distinctive full name with matching details).
- "unclear": only the name matches, or the evidence is missing or conflicting.

Rules:
- Use only the evidence given. Never assume facts that aren't there. A common name alone is "unclear", never "same_person" or "different_person".
- East African names: spelling variants (Mohamed / Mohammed / Maxamed, Hussein / Xuseen), name order and connectors (bin, wa, arap) don't make names different.
- Sanctions hits are the most serious: only call one "different_person" when an identifier clearly conflicts.
- Each reason must name the evidence (e.g. "Customer born 1991; listed person born 1968").
- Overall: "clear" when every hit is a different person; "confirm" when any hit is the same person; otherwise "escalate", saying what to obtain.
- Write for a compliance file: plain, factual, short.`;

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return `${label}: ${Array.isArray(value) ? value.join("; ") : String(value)}`;
}

const clean = (value: string) => value.replace(/[<>]/g, "").slice(0, 600);

export function buildPrompt(subject: ReviewSubject, hits: HitEvidence[]): string {
  const customer = [
    line("Name", subject.name),
    line("Type", subject.entityType === "entity" ? "Organisation" : "Individual"),
    line("Date of birth", subject.dateOfBirth ?? "not provided"),
    line("Nationality", subject.nationality ?? "not provided"),
    line("Country", subject.country ?? "not provided"),
    line("ID / passport number", subject.idNumber ? "provided" : "not provided"),
    line("Registration number", subject.registrationNumber),
    line("Also known as", subject.aliases),
  ].filter(Boolean);
  const blocks = hits.map((hit, index) =>
    [
      `<hit index="${index}">`,
      line("Listed name", clean(hit.name)),
      line("Source", hit.source),
      line("Categories", hit.categories),
      line("PEP class", hit.pepClass),
      line("Programme", hit.program && hit.program !== "unknown" ? clean(hit.program) : null),
      line("Name match score", hit.matchScore),
      line("How it matched", hit.matchMethod),
      line("Listed country", hit.matchedCountry),
      line("Country check", hit.countryCheck),
      line("Date of birth check", hit.birthDateCheck),
      line("ID number check", hit.idNumberCheck),
      line("Risk topics", hit.topics),
      line("Positions held", hit.positions?.map(clean)),
      hit.listed ? line("Listed dates of birth", hit.listed.birthDates) : null,
      hit.listed ? line("Listed nationalities", hit.listed.nationalities) : null,
      hit.listed ? line("Listed countries", hit.listed.countries) : null,
      hit.listed ? line("Listed aliases", hit.listed.aliases.slice(0, 10).map(clean)) : null,
      hit.listed ? line("Listed gender", hit.listed.gender) : null,
      hit.listed ? line("Listing notes", hit.listed.notes.slice(0, 3).map(clean)) : null,
      hit.media ? line("News headline", clean(hit.media.title)) : null,
      hit.media ? line("Published", [hit.media.domain, hit.media.publishedAt].filter(Boolean).join(", ")) : null,
      hit.media ? line("Earlier AI reading: about this customer", hit.media.aboutSubject) : null,
      hit.media ? line("Article summary", clean(hit.media.summary)) : null,
      "</hit>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `Customer screened:\n${customer.join("\n")}\n\nHits to review:\n${blocks.join("\n\n")}`;
}

// Safety rules over the model's answer.
export function applyGuardrails(raw: Omit<AiAssessment, "hits" | "guardrail"> & { hits: HitAssessment[] }, hits: HitEvidence[]): AiAssessment {
  const byIndex = new Map(raw.hits.map((hit) => [hit.index, hit]));
  const merged = hits.map((hit, index) => {
    const assessed = byIndex.get(index) ?? { index, assessment: "unclear" as const, confidence: "low" as const, reasons: ["Not assessed."], missingInformation: [] };
    return {
      ...assessed,
      index,
      reasons: assessed.reasons.slice(0, 6).map((reason) => reason.slice(0, 400)),
      missingInformation: assessed.missingInformation.slice(0, 4).map((item) => item.slice(0, 200)),
      name: hit.name,
      source: hit.source,
      sourceRecordId: hit.sourceRecordId,
    };
  });
  let recommendation = raw.recommendation;
  let guardrail: string | null = null;
  const sanctions = (index: number) => hits[index].categories.includes("sanctions");
  if (merged.some((hit) => hit.assessment === "same_person")) {
    if (recommendation !== "confirm") guardrail = "A hit was judged the same person, so the recommendation is to confirm the match.";
    recommendation = "confirm";
  } else if (merged.some((hit) => hit.assessment !== "different_person")) {
    if (recommendation === "clear") guardrail = "Not every hit was shown to be a different person, so the recommendation is to escalate.";
    if (recommendation === "clear") recommendation = "escalate";
  } else if (merged.some((hit, index) => sanctions(index) && hit.confidence === "low")) {
    guardrail = "A sanctions hit was cleared only with low confidence, so a person must check it.";
    recommendation = "escalate";
  }
  return { recommendation, confidence: guardrail ? "low" : raw.confidence, summary: raw.summary.slice(0, 1200), hits: merged, guardrail };
}

export async function assessHits(client: Anthropic, subject: ReviewSubject, hits: HitEvidence[]): Promise<AiAssessment> {
  const reviewed = hits.slice(0, MAX_HITS_REVIEWED);
  const response = await client.beta.messages.parse({
    model: AI_REVIEW_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(SCHEMA) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(subject, reviewed) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The review was declined");
  if (response.stop_reason === "max_tokens") throw new Error("The review was cut off");
  const parsed = response.parsed_output as (Omit<AiAssessment, "hits" | "guardrail"> & { hits: HitAssessment[] }) | null;
  if (!parsed) throw new Error("The review returned no structured output");
  return applyGuardrails(parsed, reviewed);
}

// The parts of an OpenSanctions profile (GET /entities/{id}) that tell
// people apart.
export function compareIdNumbers(customer: string | null | undefined, listed: string[]): HitEvidence["idNumberCheck"] {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mine = customer ? normalize(customer) : "";
  const theirs = listed.map(normalize).filter(Boolean);
  if (!mine || theirs.length === 0) return null;
  return theirs.includes(mine) ? "matches a listed ID number" : "differs from the listed ID numbers";
}

export function listedDetails(raw: unknown): HitEvidence["listed"] {
  const properties = ((raw as { properties?: Record<string, unknown> } | null)?.properties ?? {}) as Record<string, unknown>;
  const strings = (key: string) => (Array.isArray(properties[key]) ? (properties[key] as unknown[]).filter((value): value is string => typeof value === "string") : []);
  return {
    birthDates: strings("birthDate").slice(0, 5),
    nationalities: [...strings("nationality"), ...strings("citizenship")].slice(0, 5),
    countries: strings("country").slice(0, 5),
    aliases: [...strings("alias"), ...strings("weakAlias")].slice(0, 10),
    idNumbers: [...strings("idNumber"), ...strings("passportNumber")].slice(0, 5),
    gender: strings("gender")[0] ?? null,
    notes: [...strings("notes"), ...strings("summary")].slice(0, 3),
  };
}
