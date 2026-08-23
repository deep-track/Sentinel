import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";

export const _log = internalMutation({
  args: {
    actorId: v.string(),
    actorType: v.union(
      v.literal("internal_admin"), 
      v.literal("reviewer"),
      v.literal("client_api_key"),
      v.literal("system"),
    ),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    clientId: v.optional(v.id("clients")),
    ipAddress: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Clients export a full audit trail of their verification history for any given period
export const exportForClient = query({
  args: {
    clientId: v.id("clients"),
    startTimestamp: v.optional(v.number()),
    endTimestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst"]);

    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();

    return rows.filter(
      (r) =>
        (args.startTimestamp === undefined || r.timestamp >= args.startTimestamp) &&
        (args.endTimestamp === undefined || r.timestamp <= args.endTimestamp),
    );
  },
});