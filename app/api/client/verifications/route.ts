import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/lib/convex-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) {
      return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "10");
    const overview = await client.query(anyApi.dashboard.overview, {
      timeRangeMs: 30 * 24 * 60 * 60 * 1000,
      recentLimit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10,
    });

    return NextResponse.json({ verifications: overview.recent });
  } catch (error) {
    console.error("[dashboard/verifications] Convex query failed", error);
    return NextResponse.json({ error: "Unable to load recent verifications" }, { status: 502 });
  }
}
