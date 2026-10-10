import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

export type ClientRole = "client_admin" | "compliance_analyst" | "developer" | "viewer";

// Must stay in sync with the roles emitted by auth0/sentinel-role-claims-action.js.
export const INTERNAL_ROLES = [
  "admin",
  "head",
  "administrator",
  "internal_admin",
  "reviewer",
  "compliance_analyst",
  "compliance_reviewer",
] as const;

const INTERNAL_ADMIN_ROLES = ["admin", "head", "administrator", "internal_admin"] as const;

type AuthIdentity = {
  subject: string;
  email?: unknown;
  emailVerified?: unknown;
  role?: unknown;
  roles?: unknown;
  permissions?: unknown;
  [key: string]: unknown;
};

// Access mode for the internal checks. When omitted it is inferred from the
// context: a query ctx (read-only db) is a read; a mutation ctx or an action
// ctx (no db) is a write, so view-only accounts fail closed.
type AccessMode = "read" | "write";

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

function roleCandidates(identity: AuthIdentity): string[] {
  return claimValues(identity)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(normalizeRole)
    .filter((role): role is string => role !== null);
}

function hasApprovedInternalRole(identity: AuthIdentity): boolean {
  return roleCandidates(identity).some((role) =>
    INTERNAL_ROLES.includes(role as (typeof INTERNAL_ROLES)[number]),
  );
}

function hasViewOnlyRole(identity: AuthIdentity): boolean {
  return roleCandidates(identity).includes("view_only");
}

function inferAccessMode(ctx: { db?: any }): AccessMode {
  // Query contexts expose a read-only db (no insert); mutation contexts can
  // write. Actions have no db and are treated as writes (fail closed).
  return ctx.db && typeof ctx.db.insert !== "function" ? "read" : "write";
}

function assertNotViewOnlyForWrite(identity: AuthIdentity, mode: AccessMode) {
  if (mode === "write" && hasViewOnlyRole(identity)) {
    throw new ConvexError({
      code: "forbidden",
      message: "This account is view-only and can't make changes.",
    });
  }
}

async function requireAuth0Identity(ctx: { auth: any }): Promise<AuthIdentity> {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  }
  return identity;
}

function identityIsInternalAdmin(identity: AuthIdentity): boolean {
  if (configuredAdminSubjects().has(identity.subject)) return true;
  // Email allow-listing only counts for a verified email; otherwise anyone
  // could sign up with an admin's address and inherit cross-tenant access.
  if (
    identity.emailVerified === true &&
    typeof identity.email === "string" &&
    configuredAdminEmails().has(identity.email.trim().toLowerCase())
  ) {
    return true;
  }
  return roleCandidates(identity).some((role) =>
    INTERNAL_ADMIN_ROLES.includes(role as (typeof INTERNAL_ADMIN_ROLES)[number]),
  );
}

// Client-portal check: is this user an active member of this client.
//
// A role set that does not include "viewer", checked from a mutation, is a
// write (query contexts are always reads). Writes are rejected when the
// client is not `active` (suspended / trial_expired), for members and
// internal admins alike, and view-only admins are denied. Reads stay
// available so a suspended tenant can still see its history.
export async function requireClientRole(
  ctx: { db: any; auth: any },
  clientId: Id<"clients">,
  allowedRoles: ClientRole[],
): Promise<{ userId: string; role: ClientRole | "internal_admin" }> {
  const identity = await requireAuth0Identity(ctx);
  const isWrite = !allowedRoles.includes("viewer") && inferAccessMode(ctx) === "write";

  const assertClientWritable = async () => {
    if (!isWrite) return;
    const client = await ctx.db.get(clientId);
    if (!client || client.status !== "active") {
      throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    }
  };

  if (identityIsInternalAdmin(identity)) {
    if (hasViewOnlyRole(identity)) {
      if (isWrite) {
        throw new ConvexError({
          code: "forbidden",
          message: "This admin account is view-only and can't act on behalf of a client.",
        });
      }
      return { userId: identity.subject, role: "viewer" };
    }
    await assertClientWritable();
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
  await assertClientWritable();
  return { userId: identity.subject, role: membership.role };
}

// Internal operations require an Auth0 role claim. View-only accounts are
// denied for writes (mode inferred from ctx unless passed explicitly).
export async function requireInternalUser(
  ctx: { db?: any; auth: any },
  mode: AccessMode = inferAccessMode(ctx),
): Promise<string> {
  const identity = await requireAuth0Identity(ctx);
  if (!hasApprovedInternalRole(identity) && !identityIsInternalAdmin(identity)) {
    throw new ConvexError({
      code: "forbidden",
      message: "An approved Sentinel internal role is required.",
    });
  }
  assertNotViewOnlyForWrite(identity, mode);
  return identity.subject;
}

export async function isInternalAdmin(ctx: { auth: any }): Promise<boolean> {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity) return false;
  return identityIsInternalAdmin(identity);
}

// True when the signed-in admin also carries the `view_only` role.
export async function isViewOnlyAdmin(ctx: { auth: any }): Promise<boolean> {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity) return false;
  return identityIsInternalAdmin(identity) && hasViewOnlyRole(identity);
}

export async function requireInternalAdmin(
  ctx: { db?: any; auth: any },
  mode: AccessMode = inferAccessMode(ctx),
): Promise<string> {
  const identity = await requireAuth0Identity(ctx);
  if (!identityIsInternalAdmin(identity)) {
    throw new ConvexError({
      code: "forbidden",
      message: "An approved Sentinel administrator role is required.",
    });
  }
  assertNotViewOnlyForWrite(identity, mode);
  return identity.subject;
}
