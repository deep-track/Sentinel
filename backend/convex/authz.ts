import { query } from "./_generated/server";
import { v } from "convex/values";

const membership = v.object({
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

/**
 * Resolves the authenticated Auth0 subject to active client memberships.
 * This is the application authorization boundary; Auth0 organization
 * membership alone never grants access to customer data.
 */
export const currentAccess = query({
  args: {},
  returns: v.object({
    authorized: v.boolean(),
    memberships: v.array(membership),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { authorized: false, memberships: [] };
    }

    const rows = await ctx.db
      .query("clientMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    const memberships = (
      await Promise.all(
        rows
          .filter((row) => row.isActive)
          .map(async (row) => {
            const client = await ctx.db.get(row.clientId);
            if (!client || client.status !== "active") return null;
            return {
              clientId: client._id,
              clientName: client.name,
              clientStatus: client.status,
              role: row.role,
            };
          }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    return {
      authorized: memberships.length > 0,
      memberships,
    };
  },
});
