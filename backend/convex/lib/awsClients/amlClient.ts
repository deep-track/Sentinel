import { asRecord, callInternalService, invalidResponse, readArray, readNumber, readString } from "./internalFetch";

export type AmlQuery = {
  entityName: string;
  entityType: "person" | "business";
};

export type AmlStatus = "CLEAR" | "PEP" | "SANCTIONS_HIT" | "ADVERSE_MEDIA";

export type AmlMatch = {
  // Known sources are "OFAC_SDN" | "UN_CONSOLIDATED" | "FBI_MOST_WANTED"; an
  // unrecognised source is kept rather than dropped.
  source: "OFAC_SDN" | "UN_CONSOLIDATED" | "FBI_MOST_WANTED" | (string & {});
  program: string;
  matchScore: number; // 0-100
  matchedCountry: string | null;
};

export type AmlResult = {
  // Upper-cased upstream status. May be outside AmlStatus; resolveAmlAction
  // routes unrecognised values to review.
  status: string;
  matches: AmlMatch[];
};

export type AmlAction =
  | "hard_stop_compliance_alert"
  | "high_confidence_match_review"
  | "enhanced_due_diligence"
  | "adverse_media_due_diligence"
  | "review_unrecognised_status"
  | "clear";

// Any match strictly above this score is never auto-cleared.
export const HIGH_CONFIDENCE_MATCH_SCORE = 85;

const PATH = "/internal/aml/query";

// Fails closed: only an explicit CLEAR with no high-confidence match clears.
export function resolveAmlAction(result: { status: string; matches: AmlMatch[] }): AmlAction {
  const status = String(result.status ?? "").trim().toUpperCase();
  if (status === "SANCTIONS_HIT") return "hard_stop_compliance_alert";
  if (result.matches.some((m) => !(m.matchScore <= HIGH_CONFIDENCE_MATCH_SCORE))) {
    // Also catches NaN scores.
    return "high_confidence_match_review";
  }
  switch (status) {
    case "PEP":
      return "enhanced_due_diligence";
    case "ADVERSE_MEDIA":
      return "adverse_media_due_diligence";
    case "CLEAR":
      return "clear";
    default:
      return "review_unrecognised_status";
  }
}

export function parseAmlResponse(raw: unknown): AmlResult {
  const body = asRecord(raw, PATH);
  const status = readString(body, "status", PATH).trim().toUpperCase();
  const matches = readArray(body, "matches", PATH).map((item) => {
    const match = asRecord(item, PATH);
    const country = match.matched_country;
    if (country !== null && country !== undefined && typeof country !== "string") {
      throw invalidResponse(PATH, "matched_country is not a string or null");
    }
    return {
      source: readString(match, "source", PATH),
      program: readString(match, "program", PATH),
      matchScore: readNumber(match, "match_score", PATH, { min: 0, max: 100 }),
      matchedCountry: typeof country === "string" ? country : null,
    };
  });
  return { status, matches };
}

export async function queryAml(query: AmlQuery): Promise<AmlResult> {
  const raw = await callInternalService(
    PATH,
    { entity_name: query.entityName, entity_type: query.entityType },
    { timeoutMs: 3_000 },
  );
  return parseAmlResponse(raw);
}
