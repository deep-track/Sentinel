import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub],
});

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

/**
 * Stable customer authorization boundary. Auth0 organization membership alone
 * never grants access to customer data.
 */
export const currentAccess = query({
  args: {},
  returns: v.object({
    authorized: v.boolean(),
    memberships: v.array(membership),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { authorized: false, memberships: [] };

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
      console.error("[auth.currentAccess] denied due to read failure", error);
      return { authorized: false, memberships: [] };
    }
  },
});
