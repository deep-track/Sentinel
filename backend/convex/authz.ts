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
    // Preserve compatibility with legacy records without granting a
    // cross-customer internal-admin role to a client membership.
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
 * Resolves the authenticated Auth0 subject to active client memberships.
 * Auth0 organization membership alone never grants customer-data access.
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

      return {
        authorized: memberships.length > 0,
        memberships,
      };
    } catch (error) {
      // Fail closed on malformed legacy data or a transient read error. The
      // caller receives no customer data and can retry without a 500 loop.
      console.error("[authz.currentAccess] denied due to read failure", error);
      return { authorized: false, memberships: [] };
    }
  },
});
