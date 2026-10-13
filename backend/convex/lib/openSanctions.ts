// OpenSanctions /match client and result classification for AML screening.
// OpenSanctions is screened in addition to the Sentinel-owned OFAC/UN lists
// (defense in depth): a hit on any source counts, and an OpenSanctions outage
// can never produce "pass". No Convex imports and `fetch` is injected, so it
// can be unit tested directly.

import type { Decision } from "./amlMatching";

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

const SANCTION_TOPICS = new Set(["sanction", "sanction.linked", "crime.terror"]);
const PEP_TOPICS = new Set(["role.pep", "role.rca", "role.oligarch"]);

export type OpenSanctionsSubject = {
  name: string;
  entityType: "individual" | "entity";
  country?: string | null;
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
  const properties: Record<string, string[]> = { name: [subject.name] };
  const country = subject.country?.trim();
  if (country) properties.country = [country];
  return {
    queries: {
      q: {
        // LegalEntity covers both companies and organizations.
        schema: subject.entityType === "individual" ? "Person" : "LegalEntity",
        properties,
      },
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Anything that doesn't match the documented response shape is an error (and
// so a coverage gap), never an empty result.
export function parseMatchResponse(raw: unknown): OpenSanctionsMatch[] {
  const response = (raw as { responses?: Record<string, unknown> } | null)?.responses?.q as
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
    };
  });
}

export async function matchOpenSanctions(
  subject: OpenSanctionsSubject,
  options: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number },
): Promise<OpenSanctionsMatch[]> {
  const url = new URL(`${options.baseUrl ?? OPENSANCTIONS_BASE_URL}/match/${OPENSANCTIONS_DATASET}`);
  url.searchParams.set("threshold", String(OPENSANCTIONS_MATCH_THRESHOLD));
  url.searchParams.set("cutoff", String(OPENSANCTIONS_MATCH_THRESHOLD));
  url.searchParams.set("limit", String(OPENSANCTIONS_RESULT_LIMIT));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: "POST",
      headers: {
        // OpenSanctions uses the "ApiKey" scheme, not "Bearer".
        Authorization: `ApiKey ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildMatchQuery(subject)),
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
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OpenSanctionsRequestError("OpenSanctions returned invalid JSON");
  }
  return parseMatchResponse(body);
}

export function categorize(match: OpenSanctionsMatch): OpenSanctionsCategory {
  if (match.topics.some((topic) => SANCTION_TOPICS.has(topic))) return "sanction";
  if (match.topics.some((topic) => PEP_TOPICS.has(topic))) return "pep";
  return match.topics.length > 0 ? "other" : "none";
}

// The matches that affect the verdict and are stored. Only results the API
// flags as matches count (already filtered by the cutoff; this guards against
// API-side default changes). Sanctions count from 0.7; PEP and other risk
// lists from 0.8; records with no risk topic never count.
export function relevantMatches(matches: OpenSanctionsMatch[]): OpenSanctionsMatch[] {
  return matches
    .filter((match) => {
      if (!match.match || match.score < OPENSANCTIONS_MATCH_THRESHOLD) return false;
      const category = categorize(match);
      if (category === "none") return false;
      return category === "sanction" || match.score >= OPENSANCTIONS_NON_SANCTION_MIN_SCORE;
    })
    .sort((left, right) => right.score - left.score);
}

export function decideOpenSanctions(matches: OpenSanctionsMatch[]): Decision {
  const relevant = relevantMatches(matches);
  if (relevant.length === 0) return { verdict: "pass", reason: "No match found on OpenSanctions." };
  const sanctions = relevant.filter((match) => categorize(match) === "sanction");
  if (sanctions.some((match) => match.score >= OPENSANCTIONS_STRONG_MATCH_SCORE)) {
    return {
      verdict: "reject",
      reason: "Strong OpenSanctions sanctions match requires compliance escalation.",
    };
  }
  if (sanctions.length > 0) {
    return { verdict: "review", reason: "Possible OpenSanctions sanctions match requires human identity resolution." };
  }
  if (relevant.some((match) => categorize(match) === "pep")) {
    return {
      verdict: "review",
      reason: "OpenSanctions politically exposed person (PEP) match requires enhanced due diligence.",
    };
  }
  return { verdict: "review", reason: "OpenSanctions risk-list match requires human review." };
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
