import { query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { isInternalAdmin } from "./lib/rbac";

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


export const overview = query({
  args: { timeRangeMs: v.optional(v.number()), recentLimit: v.optional(v.number()) },
  returns: dashboardResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
    }

    const clientIds = await (async () => {
      if (await isInternalAdmin(ctx)) {
        const clients = await ctx.db.query("clients").collect();
        return clients
          .filter((client: any) => client.status === "active")
          .map((client: any) => client._id);
      }

      const memberships = await ctx.db
        .query("clientMembers")
        .withIndex("by_user", (q) => q.eq("userId", identity.subject))
        .collect();
      return memberships
        .filter((membership: any) => membership.isActive)
        .map((membership: any) => membership.clientId);
    })();

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

const customerMembership = v.object({
  clientId: v.id("clients"),
  clientName: v.string(),
  clientStatus: v.union(
    v.literal("active"),
    v.literal("suspended"),
    v.literal("trial_expired"),
  ),
  role: v.union(
    v.literal("client_admin"),
    v.literal("compliance_analyst"),
    v.literal("developer"),
    v.literal("viewer"),
  ),
});

type ClientRole =
  | "client_admin"
  | "compliance_analyst"
  | "developer"
  | "viewer";

function normalizeClientRole(value: unknown): ClientRole | null {
  switch (String(value)) {
    case "client_admin":
    case "compliance_analyst":
    case "developer":
    case "viewer":
      return value as ClientRole;
    case "admin":
    case "administrator":
      return "client_admin";
    case "analyst":
      return "compliance_analyst";
    case "member":
      return "viewer";
    default:
      return null;
  }
}

/** Stable customer authorization boundary. */
export const currentAccess = query({
  args: {},
  returns: v.object({
    authorized: v.boolean(),
    memberships: v.array(customerMembership),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { authorized: false, memberships: [] };

    if (await isInternalAdmin(ctx)) {
      const clients = (await ctx.db.query("clients").collect()).filter((client) => client.status === "active");
      return {
        authorized: clients.length > 0,
        memberships: clients.map((client) => ({
          clientId: client._id,
          clientName: client.name,
          clientStatus: client.status,
          role: "client_admin" as const,
        })),
      };
    }

    try {
      const rows = await ctx.db
        .query("clientMembers")
        .withIndex("by_user", (q) => q.eq("userId", identity.subject))
        .collect();

      const memberships = (
        await Promise.all(
          rows
            .filter((row) => row.isActive)
            .map(async (row) => {
              const role = normalizeClientRole(row.role);
              if (!role) return null;

              const client = await ctx.db.get(row.clientId);
              if (!client || client.status !== "active") return null;

              return {
                clientId: client._id,
                clientName: client.name,
                clientStatus: client.status,
                role,
              };
            }),
        )
      ).filter((row): row is NonNullable<typeof row> => row !== null);

      return { authorized: memberships.length > 0, memberships };
    } catch (error) {
      console.error("[dashboard.currentAccess] denied due to read failure", error);
      return { authorized: false, memberships: [] };
    }
  },
});
