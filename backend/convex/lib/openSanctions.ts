// OpenSanctions /match client and result classification for AML screening.
// OpenSanctions is screened in addition to the Sentinel-owned OFAC/UN lists
// (defense in depth): a hit on any source counts, and an OpenSanctions outage
// can never produce "pass". No Convex imports and `fetch` is injected, so it
// can be unit tested directly.

import type { Decision } from "./amlMatching";
import { PEP_CLASS_LABELS, birthDateMatch, categoriesFor, pepClassFor, type PepClass, type RiskCategory } from "./amlCategories";

export const OPENSANCTIONS_BASE_URL = "https://api.opensanctions.org";
export const OPENSANCTIONS_DATASET = "default";
// The API's own default; results at or above it come back with match: true.
export const OPENSANCTIONS_MATCH_THRESHOLD = 0.7;
// A sanctions-topic match at or above this score is a hard stop ("reject").
export const OPENSANCTIONS_STRONG_MATCH_SCORE = 0.9;
// PEP and other risk-list matches need a closer name match than sanctions
// before they hold a screening: a 0.7 PEP hit is usually a different person
// with a similar name ("Utkin" for "Putin"), and each one costs a review.
export const OPENSANCTIONS_NON_SANCTION_MIN_SCORE = 0.8;
export const OPENSANCTIONS_RESULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

export type OpenSanctionsSubject = {
  name: string;
  entityType: "individual" | "entity";
  country?: string | null;
  // Optional identifiers. Sent to the match API, which uses them to score
  // candidates; a conflicting date of birth also rules out look-alikes.
  aliases?: string[];
  birthDate?: string | null; // YYYY, YYYY-MM or YYYY-MM-DD
  nationality?: string | null;
  idNumber?: string | null;
  registrationNumber?: string | null;
  jurisdiction?: string | null;
};

export type OpenSanctionsMatch = {
  id: string;
  caption: string;
  schema: string;
  score: number; // 0-1
  match: boolean;
  datasets: string[];
  topics: string[];
  countries: string[];
  birthDates: string[];
  // Set by annotateBirthDates against the subject's date of birth.
  birthDateMatch?: "match" | "mismatch" | "unknown";
  // Set by applyPepPositions from the person's recorded positions.
  pepPositions?: PepPosition[];
  pepStatus?: "current" | "former" | "unknown";
  positionPepClass?: PepClass | null;
};

export type PepPosition = {
  title: string;
  country: string | null;
  topics: string[];
  startDate: string | null;
  endDate: string | null;
  current: boolean;
};

// "none" = no risk topic at all: enrichment records such as company
// registries (ext_* datasets) or reference data, not a risk list.
export type OpenSanctionsCategory = "sanction" | "pep" | "other" | "none";

// "screened" is the only status that counts as coverage.
export type OpenSanctionsOutcome =
  | { status: "screened"; matches: OpenSanctionsMatch[] }
  | { status: "unavailable" | "not_configured" };

export class OpenSanctionsRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenSanctionsRequestError";
  }
}

export function buildMatchQuery(subject: OpenSanctionsSubject) {
  return { queries: { q: buildQuery(subject) } };
}

// One query of a /match request. Several subjects can be matched in one
// request (matchOpenSanctionsMany), each under its own key.
export function buildQuery(subject: OpenSanctionsSubject) {
  const properties: Record<string, string[]> = { name: [subject.name] };
  const add = (key: string, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) properties[key] = [trimmed];
  };
  add("country", subject.country);
  const aliases = (subject.aliases ?? []).map((alias) => alias.trim()).filter(Boolean);
  if (aliases.length > 0) properties.alias = aliases;
  if (subject.entityType === "individual") {
    add("birthDate", subject.birthDate);
    add("nationality", subject.nationality);
    add("idNumber", subject.idNumber);
  } else {
    add("registrationNumber", subject.registrationNumber);
    add("jurisdiction", subject.jurisdiction);
  }
  return {
    // LegalEntity covers both companies and organizations.
    schema: subject.entityType === "individual" ? "Person" : "LegalEntity",
    properties,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Anything that doesn't match the documented response shape is an error (and
// so a coverage gap), never an empty result.
export function parseMatchResponse(raw: unknown, key = "q"): OpenSanctionsMatch[] {
  const response = (raw as { responses?: Record<string, unknown> } | null)?.responses?.[key] as
    | { status?: unknown; results?: unknown }
    | undefined;
  if (!response || typeof response !== "object") {
    throw new OpenSanctionsRequestError("OpenSanctions response is missing the query result");
  }
  if (response.status !== undefined && response.status !== 200) {
    throw new OpenSanctionsRequestError("OpenSanctions query failed", Number(response.status) || undefined);
  }
  if (!Array.isArray(response.results)) {
    throw new OpenSanctionsRequestError("OpenSanctions response has no results array");
  }
  return response.results.map((item) => {
    const result = item as Record<string, unknown>;
    const properties = (result.properties ?? {}) as Record<string, unknown>;
    if (typeof result.id !== "string" || typeof result.score !== "number" || !Number.isFinite(result.score)) {
      throw new OpenSanctionsRequestError("OpenSanctions result is missing an id or score");
    }
    return {
      id: result.id,
      caption: typeof result.caption === "string" ? result.caption : result.id,
      schema: typeof result.schema === "string" ? result.schema : "Thing",
      score: result.score,
      match: result.match === true,
      datasets: stringArray(result.datasets),
      topics: stringArray(properties.topics),
      countries: [
        ...new Set([
          ...stringArray(properties.country),
          ...stringArray(properties.nationality),
          ...stringArray(properties.jurisdiction),
        ]),
      ],
      birthDates: stringArray(properties.birthDate),
    };
  });
}

type RequestOptions = { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number };

export async function matchOpenSanctions(subject: OpenSanctionsSubject, options: RequestOptions): Promise<OpenSanctionsMatch[]> {
  return parseMatchResponse(await postMatch({ q: buildQuery(subject) }, options));
}

// Matches several subjects in one request. Each element of the result is
// that subject's matches, or an error when only its query failed.
export async function matchOpenSanctionsMany(
  subjects: OpenSanctionsSubject[],
  options: RequestOptions,
): Promise<Array<OpenSanctionsMatch[] | OpenSanctionsRequestError>> {
  if (subjects.length === 0) return [];
  const queries = Object.fromEntries(subjects.map((subject, index) => [`s${index}`, buildQuery(subject)]));
  const body = await postMatch(queries, options);
  return subjects.map((_, index) => {
    try {
      return parseMatchResponse(body, `s${index}`);
    } catch (error) {
      return error instanceof OpenSanctionsRequestError ? error : new OpenSanctionsRequestError("OpenSanctions query failed");
    }
  });
}

async function postMatch(queries: Record<string, unknown>, options: RequestOptions): Promise<unknown> {
  const url = new URL(`${options.baseUrl ?? OPENSANCTIONS_BASE_URL}/match/${OPENSANCTIONS_DATASET}`);
  url.searchParams.set("threshold", String(OPENSANCTIONS_MATCH_THRESHOLD));
  url.searchParams.set("cutoff", String(OPENSANCTIONS_MATCH_THRESHOLD));
  url.searchParams.set("limit", String(OPENSANCTIONS_RESULT_LIMIT));
  return requestJson(url, { method: "POST", body: JSON.stringify({ queries }) }, options);
}

// GET /entities/{id}?nested=true: the entity with its related records
// (for a person, their position occupancies and the positions held).
export async function fetchEntityNested(entityId: string, options: RequestOptions): Promise<unknown> {
  const url = new URL(`${options.baseUrl ?? OPENSANCTIONS_BASE_URL}/entities/${encodeURIComponent(entityId)}`);
  url.searchParams.set("nested", "true");
  return requestJson(url, { method: "GET" }, options);
}

async function requestJson(url: URL, init: { method: string; body?: string }, options: RequestOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: init.method,
      headers: {
        // OpenSanctions uses the "ApiKey" scheme, not "Bearer".
        Authorization: `ApiKey ${options.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      ...(init.body ? { body: init.body } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new OpenSanctionsRequestError("OpenSanctions request timed out");
    throw new OpenSanctionsRequestError(
      `OpenSanctions request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new OpenSanctionsRequestError(`OpenSanctions returned HTTP ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new OpenSanctionsRequestError("OpenSanctions returned invalid JSON");
  }
}

function firstString(value: unknown): string | null {
  const values = stringArray(value);
  return values[0] ?? null;
}

function nestedEntities(value: unknown): Array<{ schema?: unknown; properties?: Record<string, unknown> }> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

// Positions from a nested entity (fetchEntityNested). An occupancy is current
// when its status says so, or when it has no end date and isn't "ended".
export function parsePepPositions(raw: unknown, now = Date.now()): PepPosition[] {
  const properties = ((raw as { properties?: Record<string, unknown> } | null)?.properties ?? {}) as Record<string, unknown>;
  const today = new Date(now).toISOString().slice(0, 10);
  const positions: PepPosition[] = [];
  for (const occupancy of nestedEntities(properties.positionOccupancies)) {
    const occ = occupancy.properties ?? {};
    const post = nestedEntities(occ.post)[0]?.properties ?? {};
    const title = firstString(post.name);
    if (!title) continue;
    const status = firstString(occ.status);
    const endDate = firstString(occ.endDate);
    const ended = status === "ended" || (endDate !== null && endDate.slice(0, 10) < today);
    positions.push({
      title: title.slice(0, 200),
      country: firstString(post.country),
      topics: stringArray(post.topics),
      startDate: firstString(occ.startDate),
      endDate,
      // No status and no end date: treated as still held (the stricter reading).
      current: !ended && (status === "current" || endDate === null),
    });
  }
  return positions;
}

// PEP class and status from positions. Current positions decide the class
// when there are any; a person with only ended positions is a former PEP.
export function classifyPositions(positions: PepPosition[]): { pepClass: PepClass | null; pepStatus: "current" | "former" | "unknown" } {
  if (positions.length === 0) return { pepClass: null, pepStatus: "unknown" };
  const current = positions.filter((position) => position.current);
  const basis = current.length > 0 ? current : positions;
  const topics = new Set(basis.flatMap((position) => position.topics));
  const levelled = [...topics].some((topic) => topic.startsWith("gov.") || topic === "mil" || topic === "role.diplo" || topic === "pol.party");
  return {
    pepClass: levelled ? pepClassFor(["role.pep", ...topics]) : null,
    pepStatus: current.length > 0 ? "current" : "former",
  };
}

// Records positions on a PEP match. A class from positions replaces the
// topic-based one; without levelled positions the topic-based class stays.
export function applyPepPositions(match: OpenSanctionsMatch, positions: PepPosition[]): OpenSanctionsMatch {
  const { pepClass: positionPepClass, pepStatus } = classifyPositions(positions);
  return { ...match, pepPositions: positions.slice(0, 10), pepStatus, positionPepClass };
}

// Records whether each match's birth dates agree with the subject's.
export function annotateBirthDates(matches: OpenSanctionsMatch[], birthDate: string | null | undefined): OpenSanctionsMatch[] {
  return matches.map((match) => ({ ...match, birthDateMatch: birthDateMatch(birthDate, match.birthDates) }));
}

export function riskCategories(match: OpenSanctionsMatch): RiskCategory[] {
  return categoriesFor(match.topics);
}

export function pepClass(match: OpenSanctionsMatch): PepClass | null {
  const fromTopics = pepClassFor(match.topics);
  if (fromTopics === null || fromTopics === 4) return fromTopics;
  return match.positionPepClass ?? fromTopics;
}

// "none" = no risk topic: company registries, reference data, or roles that
// carry no AML risk on their own (e.g. a bank, a journalist).
export function categorize(match: OpenSanctionsMatch): OpenSanctionsCategory {
  const categories = riskCategories(match);
  if (categories.includes("sanctions")) return "sanction";
  if (categories.includes("pep")) return "pep";
  return categories.length > 0 ? "other" : "none";
}

// The matches that affect the verdict and are stored. Only results the API
// flags as matches count (already filtered by the cutoff; this guards against
// API-side default changes). Sanctions count from 0.7; PEP and other risk
// lists from 0.8; records with no risk topic never count. A non-sanctions
// match whose date of birth contradicts the subject's is a different person.
export function relevantMatches(matches: OpenSanctionsMatch[]): OpenSanctionsMatch[] {
  return matches
    .filter((match) => {
      if (!match.match || match.score < OPENSANCTIONS_MATCH_THRESHOLD) return false;
      const category = categorize(match);
      if (category === "none") return false;
      if (category === "sanction") return true;
      return match.birthDateMatch !== "mismatch" && match.score >= OPENSANCTIONS_NON_SANCTION_MIN_SCORE;
    })
    .sort((left, right) => right.score - left.score);
}

export function decideOpenSanctions(matches: OpenSanctionsMatch[]): Decision {
  const relevant = relevantMatches(matches);
  if (relevant.length === 0) return { verdict: "pass", reason: "No match found on OpenSanctions." };
  const sanctions = relevant.filter((match) => categorize(match) === "sanction");
  // A conflicting date of birth can't be a hard stop, only a review.
  if (sanctions.some((match) => match.score >= OPENSANCTIONS_STRONG_MATCH_SCORE && match.birthDateMatch !== "mismatch")) {
    return {
      verdict: "reject",
      reason: "Strong OpenSanctions sanctions match requires compliance escalation.",
    };
  }
  if (sanctions.length > 0) {
    return { verdict: "review", reason: "Possible OpenSanctions sanctions match requires human identity resolution." };
  }
  const peps = relevant.filter((match) => pepClass(match) !== null);
  if (peps.length > 0) {
    const highest = Math.min(...peps.map((match) => pepClass(match)!)) as PepClass;
    const former = peps.every((match) => match.pepStatus === "former");
    return {
      verdict: "review",
      reason: `OpenSanctions ${former ? "former " : ""}politically exposed person match (${PEP_CLASS_LABELS[highest]}) requires enhanced due diligence.`,
    };
  }
  const categories = new Set(relevant.flatMap(riskCategories));
  if (categories.has("fitness_probity")) {
    return { verdict: "review", reason: "OpenSanctions fitness and probity match (disqualification, debarment or regulator action) requires human review." };
  }
  if (categories.has("insolvency")) {
    return { verdict: "review", reason: "OpenSanctions insolvency match requires human review." };
  }
  return { verdict: "review", reason: "OpenSanctions special interest match (crime, wanted or person of interest) requires human review." };
}

const VERDICT_RANK: Record<Decision["verdict"], number> = { pass: 0, review: 1, reject: 2 };

// Merges the OFAC/UN watchlist decision with the OpenSanctions outcome. The
// stricter verdict wins, and screening is only "complete" (auto-pass and
// billable) when both the watchlists and OpenSanctions were screened.
export function combineWithOpenSanctions(
  watchlist: Decision & { complete: boolean },
  openSanctions: OpenSanctionsOutcome,
): Decision & { complete: boolean } {
  const complete = watchlist.complete && openSanctions.status === "screened";
  const osDecision = openSanctions.status === "screened" ? decideOpenSanctions(openSanctions.matches) : null;

  let verdict: Decision["verdict"] = watchlist.verdict;
  if (osDecision && VERDICT_RANK[osDecision.verdict] > VERDICT_RANK[verdict]) verdict = osDecision.verdict;
  if (!complete && verdict === "pass") verdict = "review";

  const reasons: string[] = [];
  const findings = [
    { decision: watchlist, rank: VERDICT_RANK[watchlist.verdict] },
    ...(osDecision ? [{ decision: osDecision, rank: VERDICT_RANK[osDecision.verdict] }] : []),
  ].sort((left, right) => right.rank - left.rank);
  for (const { decision } of findings) reasons.push(decision.reason);
  if (openSanctions.status === "unavailable") {
    reasons.push("OpenSanctions screening was unavailable — held for manual review.");
  } else if (openSanctions.status === "not_configured") {
    reasons.push("OpenSanctions screening is not configured — held for manual review.");
  }
  return { verdict, reason: reasons.join(" "), complete };
}
