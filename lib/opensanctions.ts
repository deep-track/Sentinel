/**
 * OpenSanctions API Integration Service
 * Provides sanctions screening via OpenSanctions API
 * 
 * API Docs: https://opensanctions.org/docs/
 */

const OPENSANCTIONS_BASE = "https://api.opensanctions.org";

// ─────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────

export type SanctionsResult = {
  id: string;
  caption: string;
  schema: string;
  score: number;
  properties: {
    name?: string[];
    birthDate?: string[];
    nationality?: string[];
    country?: string[];
    topics?: string[];
    program?: string[];
    sourceUrl?: string[];
    notes?: string[];
  };
  datasets: string[];
  countries?: string[];
  topics?: string[];
};

export type SanctionsSearchResponse = {
  results: SanctionsResult[];
  total: { value: number; relation: string };
  query: string;
};

export type AMLRiskLevel = "clear" | "low" | "medium" | "high" | "sanctioned";

// Legacy types for backward compatibility
export type RiskLevel = AMLRiskLevel;

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  summary: string;
  color: string;
  icon: string;
}

export interface SanctionsSearchResult {
  query: string;
  results: SanctionsResult[];
  riskLevel: RiskLevel;
  assessment: RiskAssessment;
  timestamp: string;
}

// Entity types for backward compatibility with screening endpoints
export interface PersonEntity {
  schema: "Person";
  properties: {
    firstName?: string[];
    lastName?: string[];
    birthDate?: string[];
    nationality?: string[];
    idNumber?: string[];
    email?: string[];
    phone?: string[];
    website?: string[];
    name?: string[];
  };
}

export interface CompanyEntity {
  schema: "Company";
  properties: {
    name: string[];
    jurisdiction?: string[];
    registrationNumber?: string[];
    website?: string[];
    email?: string[];
    phone?: string[];
    incorporationDate?: string[];
  };
}

export interface LegalEntityProperties {
  schema: "LegalEntity";
  properties: {
    name: string[];
    jurisdiction?: string[];
    registrationNumber?: string[];
    website?: string[];
    country?: string[];
  };
}

export interface VesselEntity {
  schema: "Vessel";
  properties: {
    name: string[];
    flag?: string[];
    imoNumber?: string[];
    mmsiNumber?: string[];
    callSign?: string[];
  };
}

export type OpenSanctionsEntity =
  | PersonEntity
  | CompanyEntity
  | LegalEntityProperties
  | VesselEntity;

export interface MatchResult {
  id: string;
  caption: string;
  schema: string;
  properties: Record<string, unknown>;
  datasets: string[];
  countries?: string[];
  score: number;
  match: boolean;
  topics?: string[];
}

// ─────────────────────────────────────────────────────────
// RISK ASSESSMENT
// ─────────────────────────────────────────────────────────

export function getAMLRiskLevel(results: SanctionsResult[]): AMLRiskLevel {
  if (!results || results.length === 0) return "clear";
  const maxScore = Math.max(...results.map((r) => r.score ?? 0));
  if (maxScore >= 0.9) return "sanctioned";
  if (maxScore >= 0.7) return "high";
  if (maxScore >= 0.5) return "medium";
  if (maxScore > 0) return "low";
  return "clear";
}

export function getRiskColor(risk: AMLRiskLevel): string {
  const map: Record<AMLRiskLevel, string> = {
    clear: "emerald",
    low: "blue",
    medium: "amber",
    high: "orange",
    sanctioned: "red",
  };
  return map[risk];
}

// Legacy risk assessment styles for backward compatibility
const RISK_ASSESSMENTS: Record<RiskLevel, RiskAssessment> = {
  clear: {
    level: "clear",
    score: 0,
    summary: "No sanctions or PEP records found",
    color: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800",
    icon: "✓",
  },
  low: {
    level: "low",
    score: 1,
    summary: "Low risk - Minor matches found, review recommended",
    color: "bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800",
    icon: "!",
  },
  medium: {
    level: "medium",
    score: 2,
    summary: "Medium risk - Relevant matches found, further investigation needed",
    color: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800",
    icon: "⚠",
  },
  high: {
    level: "high",
    score: 3,
    summary: "High risk - Strong match to sanctions list or PEP record",
    color: "bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800",
    icon: "⚠",
  },
  sanctioned: {
    level: "sanctioned",
    score: 4,
    summary: "SANCTIONED - Individual or entity on official sanctions list",
    color: "bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800",
    icon: "✕",
  },
};

export function getRiskLevelStyles(level: RiskLevel): {
  bgColor: string;
  textColor: string;
  borderColor: string;
  badgeColor: string;
} {
  const styles: Record<RiskLevel, any> = {
    clear: {
      bgColor: "bg-emerald-50 dark:bg-emerald-900/10",
      textColor: "text-emerald-800 dark:text-emerald-200",
      borderColor: "border-emerald-200 dark:border-emerald-800",
      badgeColor: "bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200",
    },
    low: {
      bgColor: "bg-blue-50 dark:bg-blue-900/10",
      textColor: "text-blue-800 dark:text-blue-200",
      borderColor: "border-blue-200 dark:border-blue-800",
      badgeColor: "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
    },
    medium: {
      bgColor: "bg-amber-50 dark:bg-amber-900/10",
      textColor: "text-amber-800 dark:text-amber-200",
      borderColor: "border-amber-200 dark:border-amber-800",
      badgeColor: "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200",
    },
    high: {
      bgColor: "bg-orange-50 dark:bg-orange-900/10",
      textColor: "text-orange-800 dark:text-orange-200",
      borderColor: "border-orange-200 dark:border-orange-800",
      badgeColor: "bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
    },
    sanctioned: {
      bgColor: "bg-red-50 dark:bg-red-900/10",
      textColor: "text-red-800 dark:text-red-200",
      borderColor: "border-red-200 dark:border-red-800",
      badgeColor: "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200",
    },
  };
  return styles[level];
}

// ─────────────────────────────────────────────────────────
// CORE SEARCH FUNCTION
// ─────────────────────────────────────────────────────────

export async function searchSanctions(params: {
  query: string;
  schema?: string;
  limit?: number;
}): Promise<SanctionsSearchResponse> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENSANCTIONS_API_KEY is not set in environment variables"
    );
  }

  const url = new URL(`${OPENSANCTIONS_BASE}/search/default`);
  url.searchParams.set("q", params.query);
  url.searchParams.set("schema", params.schema ?? "Person");
  url.searchParams.set("limit", String(params.limit ?? 10));

  console.log("[OpenSanctions] Searching:", url.toString());

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      // CRITICAL: OpenSanctions uses "ApiKey" NOT "Bearer"
      Authorization: `ApiKey ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[OpenSanctions] API error:", res.status, text);
    throw new Error(
      `OpenSanctions API returned ${res.status}: ${text}`
    );
  }

  const data = await res.json();
  console.log(
    "[OpenSanctions] Results:",
    data.total?.value,
    "matches"
  );
  return data;
}

// Legacy function for backward compatibility with AML page
export async function searchAML(
  fullName: string,
  country?: string
): Promise<{ success: boolean; data?: SanctionsSearchResult; error?: string }> {
  try {
    if (!fullName || fullName.trim().length === 0) {
      return { success: false, error: "Full name is required" };
    }

    const results = await searchSanctions({
      query: fullName.trim(),
      schema: "Person",
      limit: 10,
    });

    const riskLevel = getAMLRiskLevel(results.results);
    const assessment = RISK_ASSESSMENTS[riskLevel];

    return {
      success: true,
      data: {
        query: fullName,
        results: results.results,
        riskLevel,
        assessment,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[searchAML] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "AML search failed",
    };
  }
}

// ─────────────────────────────────────────────────────────
// BATCH MATCHING (LEGACY SCREENING API)
// ─────────────────────────────────────────────────────────

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 100;

export async function batchMatchEntities(
  entities: Array<{ id: string; data: OpenSanctionsEntity }>
): Promise<Record<string, MatchResult[]>> {
  const allResults: Record<string, MatchResult[]> = {};

  // For now, use search API for each entity as a fallback
  // In production, you would use the proper /api/v1/match endpoint
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);

    try {
      for (const entity of batch) {
        const name =
          (entity.data.properties.name as string[] | undefined)?.[0] ??
          ((entity.data.properties as any).firstName as string | undefined) ??
          "";

        if (!name) {
          allResults[entity.id] = [];
          continue;
        }

        const results = await searchSanctions({
          query: name,
          schema: entity.data.schema,
          limit: 10,
        });

        allResults[entity.id] = results.results as MatchResult[];
      }

      if (i + BATCH_SIZE < entities.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    } catch (error) {
      console.error(
        `[OpenSanctions] Batch failed for entities ${i}-${i + BATCH_SIZE}:`,
        error
      );
      batch.forEach((entity) => {
        allResults[entity.id] = [];
      });
    }
  }

  return allResults;
}

// ─────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────

export function getPrimaryMatch(matches: MatchResult[]): MatchResult | null {
  if (matches.length === 0) return null;
  return matches.reduce((best, current) =>
    current.score > best.score ? current : best
  );
}

export function formatDatasets(datasets: string[]): string {
  if (datasets.length === 0) return "—";
  return datasets.join(", ");
}

export function formatConfidenceScore(score?: number): string {
  if (!score) return "—";
  return `${Math.round(score * 100)}%`;
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function hasHighConfidenceMatch(matches: MatchResult[]): boolean {
  return matches.some((m) => m.score >= 0.8 && m.match);
}

/**
 * Fetch a single entity by ID from OpenSanctions API
 * Returns the full entity details including all properties
 */
export async function getEntityById(
  id: string
): Promise<SanctionsResult | null> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY;
  if (!apiKey) throw new Error("OPENSANCTIONS_API_KEY not set");

  // OpenSanctions entity lookup endpoint
  const url = `https://api.opensanctions.org/entities/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `ApiKey ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenSanctions API ${res.status}: ${text}`);
    }

    return res.json();
  } catch (error) {
    console.error("[OpenSanctions] Failed to fetch entity:", error);
    throw error;
  }
}

