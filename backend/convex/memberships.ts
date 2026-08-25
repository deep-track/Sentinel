import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireInternalAdmin } from "./lib/rbac";

const clientRole = v.union(
  v.literal("client_admin"),
  v.literal("compliance_analyst"),
  v.literal("developer"),
  v.literal("viewer"),
);

export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireInternalAdmin(ctx);
    return await ctx.db
      .query("clientMembers")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    clientId: v.id("clients"),
    userId: v.string(),
    role: clientRole,
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) {
      throw new ConvexError({ code: "not_found", message: "Client account not found." });
    }
    if (client.status !== "active") {
      throw new ConvexError({ code: "forbidden", message: "Cannot grant access to an inactive client." });
    }

    const existing = await ctx.db
      .query("clientMembers")
      .withIndex("by_client_and_user", (q) =>
        q.eq("clientId", args.clientId).eq("userId", args.userId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        isActive: true,
        invitedBy: actorId,
      });
      return existing._id;
    }

    return await ctx.db.insert("clientMembers", {
      clientId: args.clientId,
      userId: args.userId,
      role: args.role,
      isActive: true,
      invitedBy: actorId,
      createdAt: Date.now(),
    });
  },
});

export const deactivate = mutation({
  args: { membershipId: v.id("clientMembers") },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new ConvexError({ code: "not_found", message: "Membership not found." });
    }
    await ctx.db.patch(args.membershipId, {
      isActive: false,
      invitedBy: actorId,
    });
    return { deactivated: true };
  },
});
