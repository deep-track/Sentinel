import { NextRequest, NextResponse } from "next/server";
import { searchSanctions, getAMLRiskLevel } from "@/lib/opensanctions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, schema, country } = body;

    if (!query || String(query).trim().length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Log for debugging
    console.log("[AML] Searching for:", query, "schema:", schema, "country:", country);

    const results = await searchSanctions({
      query: String(query).trim(),
      schema: schema ?? "Person",
      country: country ?? undefined,
      limit: 10,
    });

    const riskLevel = getAMLRiskLevel(results.results);

    console.log("[AML] Risk level:", riskLevel, "Total:", results.total?.value);

    return NextResponse.json({
      status: 200,
      data: {
        query: String(query).trim(),
        riskLevel,
        hasMatches: results.results.length > 0,
        total: results.total?.value ?? 0,
        results: results.results ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AML search failed";
    console.error("[AML] Error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
