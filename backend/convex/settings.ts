import { query } from "./_generated/server";
import { isInternalAdmin } from "./lib/rbac";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const memberships = await ctx.db
      .query("clientMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    const organizations = [];
    for (const membership of memberships) {
      if (!membership.isActive) continue;
      const client = await ctx.db.get(membership.clientId);
      if (!client) continue;
      organizations.push({
        clientId: client._id,
        name: client.name,
        plan: client.plan,
        status: client.status,
        role: membership.role,
      });
    }

    return {
      userId: identity.subject,
      email: typeof identity.email === "string" ? identity.email : null,
      name: typeof identity.name === "string" ? identity.name : (typeof identity.nickname === "string" ? identity.nickname : null),
      isInternalAdmin: await isInternalAdmin(ctx),
      organizations,
    };
  },
});