import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireInternalAdmin } from "./lib/rbac";
import { recordAudit } from "./auditLog";

const MAX_MEMBERS_LISTED = 500;

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
      .take(MAX_MEMBERS_LISTED);
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
      await recordAudit(ctx, {
        actorId,
        actorType: "internal_admin",
        action: "membership.updated",
        targetType: "user",
        targetId: args.userId,
        clientId: args.clientId,
        metadata: {
          membershipId: existing._id,
          before: { role: existing.role, isActive: existing.isActive },
          after: { role: args.role, isActive: true },
        },
      });
      return existing._id;
    }

    const membershipId = await ctx.db.insert("clientMembers", {
      clientId: args.clientId,
      userId: args.userId,
      role: args.role,
      isActive: true,
      invitedBy: actorId,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "membership.created",
      targetType: "user",
      targetId: args.userId,
      clientId: args.clientId,
      metadata: { membershipId, after: { role: args.role, isActive: true } },
    });
    return membershipId;
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
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "membership.deactivated",
      targetType: "user",
      targetId: membership.userId,
      clientId: membership.clientId,
      metadata: {
        membershipId: args.membershipId,
        before: { role: membership.role, isActive: membership.isActive },
        after: { role: membership.role, isActive: false },
      },
    });
    return { deactivated: true };
  },
});
