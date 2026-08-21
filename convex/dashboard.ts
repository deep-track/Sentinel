import { query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

const dashboardResult = v.object({
  total: v.number(),
  avgCompletionTimeMs: v.union(v.number(), v.null()),
  pendingReview: v.number(),
  activeApiKeys: v.number(),
  breakdown: v.array(
    v.object({
      type: v.string(),
      count: v.number(),
      percentage: v.number(),
    }),
  ),
  recent: v.array(
    v.object({
      id: v.string(),
      caseId: v.string(),
      type: v.string(),
      subjectName: v.union(v.string(), v.null()),
      status: v.string(),
      sentinelScore: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
});

/**
 * Returns the authenticated user's tenant-scoped dashboard view.
 *
 * Membership is derived from the Auth0/Convex identity in the request. No
 * client or user identifier is accepted from the browser, which prevents a
 * dashboard caller from selecting another tenant by changing query params.
 */
export const overview = query({
  args: { timeRangeMs: v.optional(v.number()), recentLimit: v.optional(v.number()) },
  returns: dashboardResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
    }

    const memberships = await ctx.db
      .query("clientMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const clientIds = memberships
      .filter((membership) => membership.isActive)
      .map((membership) => membership.clientId);

    const since = Date.now() - (args.timeRangeMs ?? 30 * 24 * 60 * 60 * 1000);
    const recentLimit = Math.min(Math.max(args.recentLimit ?? 10, 1), 50);
    const rows = (
      await Promise.all(
        clientIds.map((clientId) =>
          ctx.db
            .query("verifications")
            .withIndex("by_client", (q) => q.eq("clientId", clientId))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((row) => row.createdAt >= since);

    const completed = rows.filter(
      (row) => row.completedAt !== undefined && row.status === "completed",
    );
    const avgCompletionTimeMs = completed.length
      ? completed.reduce(
          (total, row) => total + ((row.completedAt ?? row.createdAt) - row.createdAt),
          0,
        ) / completed.length
      : null;

    const typeCounts = new Map<string, number>();
    for (const row of rows) {
      typeCounts.set(row.type, (typeCounts.get(row.type) ?? 0) + 1);
    }
    const breakdown = [...typeCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, count]) => ({
        type,
        count,
        percentage: rows.length ? Math.round((count / rows.length) * 1000) / 10 : 0,
      }));

    const recent = [...rows]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, recentLimit)
      .map((row) => ({
        id: row._id,
        caseId: row.reference,
        type: row.type,
        subjectName:
          typeof row.input === "object" && row.input !== null && "subjectName" in row.input
            ? typeof row.input.subjectName === "string"
              ? row.input.subjectName
              : null
            : null,
        status:
          row.verdict === "pass"
            ? "APPROVED"
            : row.verdict === "reject"
              ? "REJECTED"
              : row.verdict === "review"
                ? "PENDING_REVIEW"
                : row.status.toUpperCase(),
        sentinelScore: row.confidence == null ? null : row.confidence * 100,
        createdAt: row.createdAt,
      }));

    const activeApiKeys = await Promise.all(
      clientIds.map((clientId) =>
        ctx.db
          .query("apiKeys")
          .withIndex("by_client", (q) => q.eq("clientId", clientId))
          .collect(),
      ),
    ).then((groups) => groups.flat().filter((key) => !key.revoked).length);

    return {
      total: rows.length,
      avgCompletionTimeMs,
      pendingReview: rows.filter((row) => row.verdict === "review").length,
      activeApiKeys,
      breakdown,
      recent,
    };
  },
});
