import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import {
  convexAuthErrorStatus,
  getConvexClientForCurrentUser,
} from "@/backend/lib/convex-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await getConvexClientForCurrentUser();
    if (result.status === "not_configured") {
      return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
    }
    if (result.status === "unauthenticated") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { client } = result;

    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("timeRange") ?? "30d";
    const timeRangeMs = timeRange === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : timeRange === "90d"
        ? 90 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    const overview = await client.query(anyApi.dashboard.overview, { timeRangeMs, recentLimit: 10 });

    return NextResponse.json({
      total: overview.total,
      avgCompletionTimeMs: overview.avgCompletionTimeMs,
      pendingReview: overview.pendingReview,
      activeApiKeys: overview.activeApiKeys,
      breakdown: overview.breakdown,
    });
  } catch (error) {
    const authStatus = convexAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json(
        { error: authStatus === 401 ? "Authentication required" : "Forbidden" },
        { status: authStatus },
      );
    }
    console.error("[dashboard/stats] Convex query failed", error);
    return NextResponse.json({ error: "Unable to load dashboard statistics" }, { status: 502 });
  }
}
