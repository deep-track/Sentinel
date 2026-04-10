"use server";

import type { SanctionsResult, AMLRiskLevel } from "@/lib/opensanctions";

export type AMLSearchResult = {
  riskLevel: AMLRiskLevel;
  hasMatches: boolean;
  total: number;
  results: SanctionsResult[];
  query: string;
};

export type AMLActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function runAMLCheck(params: {
  query: string;
  schema?: "Person" | "Company" | "Organization";
  country?: string;
}): Promise<AMLActionResult<AMLSearchResult>> {
  try {
    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    console.log("[runAMLCheck] Calling:", `${appUrl}/api/aml/search`);

    const res = await fetch(`${appUrl}/api/aml/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query,
        schema: params.schema ?? "Person",
        country: params.country,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[runAMLCheck] API error:", data);
      return {
        success: false,
        error: data.error ?? `Request failed with status ${res.status}`,
      };
    }

    return { success: true, data: data.data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AML check failed";
    console.error("[runAMLCheck] Exception:", message);
    return { success: false, error: message };
  }
}

// Legacy function for backward compatibility with AML check page
export async function searchAML(
  fullName: string,
  country?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!fullName || fullName.trim().length === 0) {
      return { success: false, error: "Full name is required" };
    }

    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    console.log("[searchAML] Calling:", `${appUrl}/api/aml/search`);

    const res = await fetch(`${appUrl}/api/aml/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: fullName,
        schema: "Person",
        country: country,
      }),
    });

    const responseData = await res.json();

    if (!res.ok) {
      console.error("[searchAML] API error:", responseData);
      return {
        success: false,
        error: responseData.error ?? `Request failed with status ${res.status}`,
      };
    }

    // Transform to legacy response format
    const data = responseData.data;
    return {
      success: true,
      data: {
        query: fullName,
        results: data.results || [],
        riskLevel: data.riskLevel,
        assessment: {
          level: data.riskLevel,
          score: 0,
          summary: `${data.total} matches found`,
          color: "bg-slate-100",
          icon: "🔍",
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AML search failed";
    console.error("[searchAML] Exception:", message);
    return { success: false, error: message };
  }
}
