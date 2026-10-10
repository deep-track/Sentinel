import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { isInternalAdmin, isViewOnlyAdmin } from "./rbac";

// Shared by dashboard.currentAccess and watchlists.currentAccess (the latter
// is the name the platform gate has historically called in production).
const MAX_MEMBERSHIPS = 50;
const MAX_CLIENTS = 500;

export const customerMembership = v.object({
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

export function normalizeClientRole(value: unknown): ClientRole | null {
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

export const currentAccessResult = v.object({
  authorized: v.boolean(),
  memberships: v.array(customerMembership),
});

export async function loadCurrentAccess(
  ctx: QueryCtx,
): Promise<Infer<typeof currentAccessResult>> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { authorized: false, memberships: [] };

    if (await isInternalAdmin(ctx)) {
      // View-only admins can browse every tenant but never act as its admin.
      const role = (await isViewOnlyAdmin(ctx)) ? ("viewer" as const) : ("client_admin" as const);
      const clients = (await ctx.db.query("clients").take(MAX_CLIENTS)).filter(
        (client) => client.status === "active",
      );
      return {
        // Internal admins are authorized even before any client exists.
        authorized: true,
        memberships: clients.map((client) => ({
          clientId: client._id,
          clientName: client.name,
          clientStatus: client.status,
          role,
        })),
      };
    }

    try {
      const rows = await ctx.db
        .query("clientMembers")
        .withIndex("by_user", (q) => q.eq("userId", identity.subject))
        .take(MAX_MEMBERSHIPS);

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
      console.error("[currentAccess] denied due to read failure", error);
      return { authorized: false, memberships: [] };
    }
}
