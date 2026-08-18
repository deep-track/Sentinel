import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

export type ClientRole = "client_admin" | "compliance_analyst" | "developer" | "viewer";

async function requireAuth0Identity(ctx: { auth: any }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  }
  return identity.subject;
}

// Client-portal check: is this user an active member of this client
export async function requireClientRole(
  ctx: { db: any; auth: any },
  clientId: Id<"clients">,
  allowedRoles: ClientRole[],
): Promise<{ userId: string; role: ClientRole }> {
  const userId = await requireAuth0Identity(ctx);

  const membership = await ctx.db
    .query("clientMembers")
    .withIndex("by_client_and_user", (q: any) =>
      q.eq("clientId", clientId).eq("userId", userId),
    )
    .unique();

  if (!membership || !membership.isActive) {
    throw new ConvexError({
      code: "forbidden",
      message: "You are not a member of this client's organization.",
    });
  }
  if (!allowedRoles.includes(membership.role)) {
    throw new ConvexError({
      code: "forbidden",
      message: `This action requires one of: ${allowedRoles.join(", ")}.`,
    });
  }

  return { userId, role: membership.role };
}

export async function requireInternalUser(ctx: { db: any; auth: any }): Promise<string> {
  return await requireAuth0Identity(ctx);
}