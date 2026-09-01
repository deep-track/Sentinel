import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

export type ClientRole = "client_admin" | "compliance_analyst" | "developer" | "viewer";

export const INTERNAL_ROLES = [
  "admin",
  "head",
  "administrator",
  "internal_admin",
  "reviewer",
] as const;

const INTERNAL_ADMIN_ROLES = ["admin", "head", "administrator", "internal_admin"] as const;

type AuthIdentity = {
  subject: string;
  email?: unknown;
  role?: unknown;
  roles?: unknown;
  permissions?: unknown;
  [key: string]: unknown;
};

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function configuredAdminEmails(): Set<string> {
  return new Set(
    (process.env.SENTINEL_INTERNAL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function configuredAdminSubjects(): Set<string> {
  return new Set(
    (process.env.SENTINEL_INTERNAL_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean),
  );
}

function claimValues(identity: AuthIdentity): unknown[] {
  return [
    identity.role,
    identity.roles,
    identity.permissions,
    identity["https://deeptrack.io/role"],
    identity["https://deeptrack.io/roles"],
    identity["https://deeptrack.io/permissions"],
  ];
}

function hasApprovedInternalRole(identity: AuthIdentity): boolean {
  const values = claimValues(identity);
  const candidates = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return candidates.some((candidate) => {
    const role = normalizeRole(candidate);
    return role !== null && INTERNAL_ROLES.includes(role as (typeof INTERNAL_ROLES)[number]);
  });
}

function isViewOnlyAdmin(identity: AuthIdentity): boolean {
  const values = claimValues(identity);
  const candidates = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return candidates.some((candidate) => normalizeRole(candidate) === "view_only");
}

async function requireAuth0Identity(ctx: { auth: any }): Promise<AuthIdentity> {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  }
  return identity;
}

// Client-portal check: is this user an active member of this client.
export async function requireClientRole(
  ctx: { db: any; auth: any },
  clientId: Id<"clients">,
  allowedRoles: ClientRole[],
): Promise<{ userId: string; role: ClientRole | "internal_admin" }> {
  const identity = await requireAuth0Identity(ctx);

  if (await isInternalAdmin({ auth: { getUserIdentity: async () => identity } })) {
    if (isViewOnlyAdmin(identity)) {
      throw new ConvexError({
        code: "forbidden",
        message: "This admin account is view-only and can't act on behalf of a client.",
      });
    }
    return { userId: identity.subject, role: "internal_admin" };
  }

  const membership = await ctx.db
    .query("clientMembers")
    .withIndex("by_client_and_user", (q: any) =>
      q.eq("clientId", clientId).eq("userId", identity.subject),
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
  return { userId: identity.subject, role: membership.role };
}

// Internal operations require an Auth0 role claim. 
export async function requireInternalUser(ctx: { db: any; auth: any }): Promise<string> {
  const identity = await requireAuth0Identity(ctx);
  if (!hasApprovedInternalRole(identity)) {
    throw new ConvexError({
      code: "forbidden",
      message: "An approved Sentinel internal role is required.",
    });
  }
  return identity.subject;
}

export async function isInternalAdmin(ctx: { auth: any }): Promise<boolean> {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity) return false;

  // Auth0 roles 
  if (configuredAdminSubjects().has(identity.subject)) return true;
  if (
    typeof identity.email === "string" &&
    configuredAdminEmails().has(identity.email.trim().toLowerCase())
  ) {
    return true;
  }

  const values = claimValues(identity);
  const candidates = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return candidates.some((candidate) => {
    const role = normalizeRole(candidate);
    return role !== null && INTERNAL_ADMIN_ROLES.includes(role as (typeof INTERNAL_ADMIN_ROLES)[number]);
  });
}

export async function requireInternalAdmin(ctx: { db: any; auth: any }): Promise<string> {
  const identity = await requireAuth0Identity(ctx);
  if (!(await isInternalAdmin({ auth: { getUserIdentity: async () => identity } }))) {
    throw new ConvexError({
      code: "forbidden",
      message: "An approved Sentinel administrator role is required.",
    });
  }
  return identity.subject;
}
