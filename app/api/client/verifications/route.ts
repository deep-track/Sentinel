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
    const limit = Number(searchParams.get("limit") ?? "10");
    const overview = await client.query(anyApi.dashboard.overview, {
      timeRangeMs: 30 * 24 * 60 * 60 * 1000,
      recentLimit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10,
    });

    return NextResponse.json({ verifications: overview.recent });
  } catch (error) {
    const authStatus = convexAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json(
        { error: authStatus === 401 ? "Authentication required" : "Forbidden" },
        { status: authStatus },
      );
    }
    console.error("[dashboard/verifications] Convex query failed", error);
    return NextResponse.json({ error: "Unable to load recent verifications" }, { status: 502 });
  }
}
