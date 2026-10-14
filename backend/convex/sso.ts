import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { randomKeySegment } from "./lib/crypto";
import { emailDomain, normalizeDomain } from "./lib/clientSettings";

// Single sign-on for a client's team (Settings → Security). The client's
// Admin connects their identity provider (Microsoft Entra ID, Google
// Workspace, SAML or OIDC); the portal's server actions create the Auth0
// enterprise connection with the Admin's IdP details (which stay in Auth0)
// after authorizeConnect here allowed it. Options: enforce SSO for the
// client's email domains, and give people who sign in through SSO without
// an invite a role (just-in-time membership).

export const SSO_CLAIM = "https://deeptrack.io/connection";

// Domains nobody can claim for SSO.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "deeptrack.io",
]);
const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const providerValidator = v.union(v.literal("entra_id"), v.literal("google_workspace"), v.literal("saml"), v.literal("oidc"));
const jitRoleValidator = v.union(v.literal("compliance_analyst"), v.literal("reviewer"), v.literal("developer"), v.literal("viewer"));

type Sso = NonNullable<Doc<"clientSettings">["sso"]>;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

async function settingsRow(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  return await ctx.db
    .query("clientSettings")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .unique();
}

async function saveSso(ctx: MutationCtx, clientId: Id<"clients">, actorId: string, sso: Sso | undefined) {
  const row = await settingsRow(ctx, clientId);
  const fields = { sso, ssoConnectionName: sso?.status === "connected" ? sso.connectionName : undefined, updatedAt: Date.now(), updatedBy: actorId };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert("clientSettings", { clientId, ...fields });
}

async function audit(ctx: MutationCtx, actor: { userId: string; role: string }, clientId: Id<"clients">, action: string, metadata: Record<string, unknown>) {
  await recordAudit(ctx, {
    actorId: actor.userId,
    actorType: actorTypeForClientRole(actor.role),
    action,
    targetType: "sso",
    targetId: clientId,
    clientId,
    metadata,
  });
}

export function cleanSsoDomains(domains: string[]): string[] {
  const cleaned = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
  if (cleaned.length === 0) invalid("Add at least one email domain your team signs in with.");
  if (cleaned.length > 10) invalid("At most 10 domains.");
  const bad = cleaned.find((domain) => !DOMAIN_PATTERN.test(domain));
  if (bad) invalid(`"${bad}" is not a valid email domain.`);
  const shared = cleaned.find((domain) => PUBLIC_EMAIL_DOMAINS.has(domain));
  if (shared) invalid(`${shared} is a public email domain and can't be used for single sign-on.`);
  return cleaned;
}

export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const row = await settingsRow(ctx, args.clientId);
    return row?.sso ?? null;
  },
});

// Called by the portal's server action before it creates the Auth0
// connection. Reserves the connection name.
export const authorizeConnect = mutation({
  args: { clientId: v.id("clients"), provider: providerValidator, domains: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const domains = cleanSsoDomains(args.domains);
    const row = await settingsRow(ctx, args.clientId);
    if (row?.sso?.status === "connected") invalid("Single sign-on is already connected. Remove it before connecting another provider.");
    // A domain can belong to one organization's SSO only.
    const others = (await ctx.db.query("clientSettings").take(2000)).filter((item) => item.clientId !== args.clientId && item.sso);
    const taken = domains.find((domain) => others.some((item) => item.sso!.domains.includes(domain)));
    if (taken) invalid(`${taken} is already used for single sign-on by another organization. Contact DeepTrack.`);
    const connectionName = row?.sso?.connectionName ?? `sso-${randomKeySegment(10).toLowerCase()}`;
    await saveSso(ctx, args.clientId, actor.userId, { status: "pending", provider: args.provider, connectionName, domains, enforce: false });
    await audit(ctx, actor, args.clientId, "sso.connect_started", { provider: args.provider, domains });
    return { connectionName, domains };
  },
});

export const recordConnected = mutation({
  args: { clientId: v.id("clients"), connectionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const sso = (await settingsRow(ctx, args.clientId))?.sso;
    if (!sso || sso.status !== "pending") invalid("Start connecting single sign-on first.");
    await saveSso(ctx, args.clientId, actor.userId, { ...sso, status: "connected", connectionId: args.connectionId.slice(0, 100), connectedAt: Date.now(), connectedBy: actor.userId });
    await audit(ctx, actor, args.clientId, "sso.connected", { provider: sso.provider, domains: sso.domains, connectionName: sso.connectionName });
    return null;
  },
});

export const cancelPending = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const sso = (await settingsRow(ctx, args.clientId))?.sso;
    if (sso?.status !== "pending") return null;
    await saveSso(ctx, args.clientId, actor.userId, undefined);
    return null;
  },
});

export const setOptions = mutation({
  args: { clientId: v.id("clients"), enforce: v.boolean(), jitRole: v.union(jitRoleValidator, v.null()) },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const sso = (await settingsRow(ctx, args.clientId))?.sso;
    if (!sso || sso.status !== "connected") invalid("Connect single sign-on first.");
    const next: Sso = { ...sso, enforce: args.enforce, ...(args.jitRole ? { jitRole: args.jitRole } : {}) };
    if (!args.jitRole) delete next.jitRole;
    await saveSso(ctx, args.clientId, actor.userId, next);
    await audit(ctx, actor, args.clientId, "sso.options_changed", { before: { enforce: sso.enforce, jitRole: sso.jitRole ?? null }, after: { enforce: args.enforce, jitRole: args.jitRole } });
    return null;
  },
});

// Called by the server action before it deletes the Auth0 connection.
export const authorizeRemove = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const sso = (await settingsRow(ctx, args.clientId))?.sso;
    if (!sso) invalid("Single sign-on isn't set up.");
    return { connectionId: sso.connectionId ?? null };
  },
});

export const recordRemoved = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const sso = (await settingsRow(ctx, args.clientId))?.sso;
    if (!sso) return null;
    await saveSso(ctx, args.clientId, actor.userId, undefined);
    await audit(ctx, actor, args.clientId, "sso.removed", { provider: sso.provider, domains: sso.domains });
    return null;
  },
});

// For the platform layout: must this member sign in through SSO?
export function ssoRequirement(sso: Sso | undefined, email: string | null | undefined) {
  if (!sso || sso.status !== "connected" || !sso.enforce || !email) return null;
  return sso.domains.includes(emailDomain(email)) ? { connectionName: sso.connectionName } : null;
}
