import { callInternalService } from "./internalFetch";

export type AmlQuery = {
  entityName: string;
  entityType: "person" | "business";
};

export type AmlStatus = "CLEAR" | "PEP" | "SANCTIONS_HIT" | "ADVERSE_MEDIA";

export type AmlMatch = {
  source: "OFAC_SDN" | "UN_CONSOLIDATED" | "FBI_MOST_WANTED";
  program: string; // e.g. "SDGT", "1988 (Taliban)"
  matchScore: number; // 0-100
  matchedCountry: string | null;
};

export type AmlResult = {
  status: AmlStatus;
  matches: AmlMatch[];
};

// Section 7.1 hit handling: any sanctions hit = hard stop + compliance
// alert. PEP = flag for enhanced due diligence (not a hard stop).
export type AmlAction = "hard_stop_compliance_alert" | "enhanced_due_diligence" | "clear";

export function resolveAmlAction(result: AmlResult): AmlAction {
  if (result.status === "SANCTIONS_HIT") return "hard_stop_compliance_alert";
  if (result.status === "PEP") return "enhanced_due_diligence";
  return "clear";
}

export async function queryAml(query: AmlQuery): Promise<AmlResult> {
  const raw = await callInternalService<{
    status: AmlStatus;
    matches: Array<{
      source: AmlMatch["source"];
      program: string;
      match_score: number;
      matched_country: string | null;
    }>;
  }>(
    "/internal/aml/query",
    { entity_name: query.entityName, entity_type: query.entityType },
    { timeoutMs: 3_000 }, // Section 7.1: <1s sanctions, 2-3s with adverse media
  );

  return {
    status: raw.status,
    matches: raw.matches.map((m) => ({
      source: m.source,
      program: m.program,
      matchScore: m.match_score,
      matchedCountry: m.matched_country,
    })),
  };
}