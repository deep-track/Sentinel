import { query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isInternalAdmin } from "./lib/rbac";
import { currentAccessResult, loadCurrentAccess } from "./lib/access";

// Read caps so the dashboard stays within Convex query limits as data grows.
// When a cap is hit the figures cover the newest rows only (`truncated`).
const MAX_VERIFICATION_ROWS = 1000;
const MAX_API_KEY_ROWS = 2000;
const MAX_MEMBERSHIPS = 50;

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
  truncated: v.optional(v.boolean()),
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


export const overview = query({
  args: { timeRangeMs: v.optional(v.number()), recentLimit: v.optional(v.number()) },
  returns: dashboardResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
    }

    const since = Date.now() - (args.timeRangeMs ?? 30 * 24 * 60 * 60 * 1000);
    const recentLimit = Math.min(Math.max(args.recentLimit ?? 10, 1), 50);

    let rows: Doc<"verifications">[];
    let clientIds: Id<"clients">[] | null;
    let truncated = false;
    if (await isInternalAdmin(ctx)) {
      // Platform-wide view: one indexed range over the time window.
      clientIds = null;
      rows = await ctx.db
        .query("verifications")
        .withIndex("by_created_at", (q) => q.gte("createdAt", since))
        .order("desc")
        .take(MAX_VERIFICATION_ROWS);
      truncated = rows.length === MAX_VERIFICATION_ROWS;
    } else {
      const memberships = await ctx.db
        .query("clientMembers")
        .withIndex("by_user", (q) => q.eq("userId", identity.subject))
        .take(MAX_MEMBERSHIPS);
      clientIds = memberships
        .filter((membership) => membership.isActive)
        .map((membership) => membership.clientId);
      // Split the read budget across the member's organisations.
      const perClientCap = Math.ceil(MAX_VERIFICATION_ROWS / Math.max(clientIds.length, 1));
      const perClient = await Promise.all(
        clientIds.map((clientId) =>
          ctx.db
            .query("verifications")
            .withIndex("by_client_and_created_at", (q) =>
              q.eq("clientId", clientId).gte("createdAt", since),
            )
            .order("desc")
            .take(perClientCap),
        ),
      );
      truncated = perClient.some((group) => group.length === perClientCap);
      rows = perClient.flat();
    }

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

    const keyGroups =
      clientIds === null
        ? [await ctx.db.query("apiKeys").take(MAX_API_KEY_ROWS)]
        : await Promise.all(
            clientIds.map((clientId) =>
              ctx.db
                .query("apiKeys")
                .withIndex("by_client", (q) => q.eq("clientId", clientId))
                .take(MAX_API_KEY_ROWS),
            ),
          );
    const activeApiKeys = keyGroups.flat().filter((key) => !key.revoked).length;

    return {
      total: rows.length,
      avgCompletionTimeMs,
      pendingReview: rows.filter((row) => row.verdict === "review").length,
      activeApiKeys,
      breakdown,
      truncated,
      recent,
    };
  },
});

/** Stable customer authorization boundary. */
export const currentAccess = query({
  args: {},
  returns: currentAccessResult,
  handler: async (ctx) => loadCurrentAccess(ctx),
});
