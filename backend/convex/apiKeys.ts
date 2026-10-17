import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildRawApiKey, parseApiKeyPrefix, sha256Hex, safeCompareHex } from "./lib/crypto";
import { requireClientRole, requireInternalAdmin } from "./lib/rbac";
import { recordLedgerEntry } from "./lib/credits";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import type { Doc, Id } from "./_generated/dataModel";
import { loadClientSettings } from "./lib/clientSettings";

const MAX_KEYS_LISTED = 200;
const KEY_INSERT_ATTEMPTS = 5;
// lastUsedAt is informational; don't write it on every request.
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

// Bootstraps a new tenant. Internal administrators only — this is NOT part
// of the public /v1 API. The plan's creditLimit is recorded as an
// "allocation" ledger entry so the tenant starts with a spendable balance.
export const createClient = mutation({
  args: {
    name: v.string(),
    plan: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("growth"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    creditLimit: v.number(),
    rpmCap: v.number(),
    // USD (default) or KES: the price list and the unit credits are counted in.
    billingCurrency: v.optional(v.union(v.literal("USD"), v.literal("KES"))),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({ code: "invalid_argument", message: "Client name is required." });
    }
    if (!Number.isFinite(args.creditLimit) || args.creditLimit < 0) {
      throw new ConvexError({ code: "invalid_argument", message: "creditLimit must be a non-negative number." });
    }
    if (!Number.isFinite(args.rpmCap) || args.rpmCap <= 0) {
      throw new ConvexError({ code: "invalid_argument", message: "rpmCap must be a positive number." });
    }

    const clientId = await ctx.db.insert("clients", {
      name,
      plan: args.plan,
      status: "active",
      creditLimit: args.creditLimit,
      creditBalance: 0,
      rpmCap: args.rpmCap,
      creditThresholdPct: 80, // Section 1.1 default — override per-client later via a settings mutation
      billingCurrency: args.billingCurrency ?? "USD",
      createdAt: Date.now(),
    });
    if (args.creditLimit > 0) {
      await recordLedgerEntry(ctx, {
        clientId,
        type: "allocation",
        amount: args.creditLimit,
        reason: `Plan credit allocation (${args.plan})`,
      });
    }
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "client.created",
      targetType: "client",
      targetId: clientId,
      clientId,
      metadata: { name, plan: args.plan, creditLimit: args.creditLimit, rpmCap: args.rpmCap, billingCurrency: args.billingCurrency ?? "USD" },
    });
    return clientId;
  },
});

// What a key may call (http.ts checks each route). Keys without scopes
// (created before scopes existed) may call everything.
export const API_SCOPES = ["verify:kyc", "verify:aml", "verify:document", "verify:kyb", "capture", "monitoring", "results:read", "credits:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "verify:kyc": "Run KYC identity checks",
  "verify:aml": "Run AML screenings",
  "verify:document": "Run IDP document checks",
  "verify:kyb": "Run business (KYB) checks",
  capture: "Create and manage capture links",
  monitoring: "Manage AML monitoring",
  "results:read": "Read check results",
  "credits:read": "Read credits and usage",
};
const scopeValidator = v.union(...API_SCOPES.map((scope) => v.literal(scope)));

// Developers and Admins manage keys; everyone else can see them.
const KEY_MANAGER_ROLES = ["client_admin", "developer"] as const;
// How long a rotated key keeps working.
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_LABEL_LENGTH = 60;

function cleanLabel(label: string | undefined) {
  const trimmed = label?.trim() || undefined;
  if (trimmed && trimmed.length > MAX_LABEL_LENGTH) {
    throw new ConvexError({ code: "invalid_argument", message: `Key names are at most ${MAX_LABEL_LENGTH} characters.` });
  }
  return trimmed;
}

function cleanScopes(scopes: ApiScope[] | undefined) {
  if (scopes === undefined) return undefined;
  const unique = [...new Set(scopes)];
  if (unique.length === 0) throw new ConvexError({ code: "invalid_argument", message: "Choose at least one scope." });
  return unique;
}

export function keyIsUsable(key: Pick<Doc<"apiKeys">, "revoked" | "expiresAt">, now = Date.now()) {
  return !key.revoked && (key.expiresAt === undefined || key.expiresAt > now);
}

export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(MAX_KEYS_LISTED);
    const now = Date.now();
    return keys.map((key) => ({
      _id: key._id,
      prefix: key.prefix,
      environment: key.environment,
      revoked: key.revoked,
      expired: !key.revoked && key.expiresAt !== undefined && key.expiresAt <= now,
      expiresAt: key.expiresAt ?? null,
      label: key.label ?? null,
      scopes: key.scopes ?? null,
      rotated: key.rotatedTo !== undefined,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    }));
  },
});

export const scopes = query({
  args: {},
  handler: async () => API_SCOPES.map((scope) => ({ value: scope, label: API_SCOPE_LABELS[scope] })),
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError({ code: "not_found", message: "API key not found." });
    const actor = await requireClientRole(ctx, key.clientId, [...KEY_MANAGER_ROLES]);
    await ctx.db.patch(args.keyId, { revoked: true });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: args.keyId,
      clientId: key.clientId,
      metadata: { prefix: key.prefix, environment: key.environment, alreadyRevoked: key.revoked },
    });
    return { revoked: true };
  },
});

// Inserts a key, regenerating on the (unlikely) event of a prefix collision.
// The prefix read and the insert share one transaction, so two concurrent
// inserts can't both claim the same prefix.
async function insertUniqueApiKey(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  environment: "live" | "test",
  details: { label?: string; scopes?: ApiScope[]; createdBy?: string } = {},
) {
  for (let attempt = 0; attempt < KEY_INSERT_ATTEMPTS; attempt++) {
    const { rawKey, prefix } = buildRawApiKey(environment);
    const clash = await ctx.db
      .query("apiKeys")
      .withIndex("by_prefix", (q) => q.eq("prefix", prefix))
      .first();
    if (clash) continue;
    const hashedKey = await sha256Hex(rawKey);
    const keyId = await ctx.db.insert("apiKeys", {
      clientId,
      prefix,
      hashedKey,
      environment,
      revoked: false,
      createdAt: Date.now(),
      ...(details.label ? { label: details.label } : {}),
      ...(details.scopes ? { scopes: details.scopes } : {}),
      ...(details.createdBy ? { createdBy: details.createdBy } : {}),
    });
    return { keyId, rawKey, prefix };
  }
  throw new ConvexError({ code: "internal", message: "Could not allocate a unique API key. Please try again." });
}

// rawKey is returned ONCE. Only the hash is stored, so the caller must show
// it to the user immediately and never log it.
export const createForClient = mutation({
  args: {
    clientId: v.id("clients"),
    environment: v.union(v.literal("live"), v.literal("test")),
    label: v.optional(v.string()),
    scopes: v.optional(v.array(scopeValidator)),
  },
  handler: async (ctx, args) => {
    // requireClientRole also rejects inactive clients for writes.
    const actor = await requireClientRole(ctx, args.clientId, [...KEY_MANAGER_ROLES]);
    const label = cleanLabel(args.label);
    const scopes = cleanScopes(args.scopes);
    const { keyId, rawKey, prefix } = await insertUniqueApiKey(ctx, args.clientId, args.environment, { label, scopes, createdBy: actor.userId });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "api_key.created",
      targetType: "api_key",
      targetId: keyId,
      clientId: args.clientId,
      metadata: { prefix, environment: args.environment, label: label ?? null, scopes: scopes ?? "all" },
    });
    return { rawKey, prefix };
  },
});

// Issues a replacement with the same name, environment and scopes. The old
// key keeps working for 24 hours (or stops now with `immediately`), so the
// new one can be deployed first.
export const rotate = mutation({
  args: { keyId: v.id("apiKeys"), immediately: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError({ code: "not_found", message: "API key not found." });
    const actor = await requireClientRole(ctx, key.clientId, [...KEY_MANAGER_ROLES]);
    if (!keyIsUsable(key)) throw new ConvexError({ code: "invalid_argument", message: "Only an active key can be rotated." });
    if (key.rotatedTo) throw new ConvexError({ code: "invalid_argument", message: "This key was already rotated." });
    const { keyId, rawKey, prefix } = await insertUniqueApiKey(ctx, key.clientId, key.environment, {
      label: key.label,
      scopes: key.scopes as ApiScope[] | undefined,
      createdBy: actor.userId,
    });
    const now = Date.now();
    const expiresAt = args.immediately ? now : now + ROTATION_GRACE_MS;
    await ctx.db.patch(key._id, { rotatedTo: keyId, expiresAt, ...(args.immediately ? { revoked: true } : {}) });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "api_key.rotated",
      targetType: "api_key",
      targetId: key._id,
      clientId: key.clientId,
      metadata: { oldPrefix: key.prefix, newPrefix: prefix, newKeyId: keyId, oldKeyExpiresAt: expiresAt },
    });
    return { rawKey, prefix, oldKeyExpiresAt: expiresAt };
  },
});

export const updateKey = mutation({
  args: { keyId: v.id("apiKeys"), label: v.optional(v.string()), scopes: v.optional(v.array(scopeValidator)) },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError({ code: "not_found", message: "API key not found." });
    const actor = await requireClientRole(ctx, key.clientId, [...KEY_MANAGER_ROLES]);
    const label = cleanLabel(args.label);
    const scopes = cleanScopes(args.scopes);
    await ctx.db.patch(key._id, { label, ...(scopes ? { scopes } : {}) });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "api_key.updated",
      targetType: "api_key",
      targetId: key._id,
      clientId: key.clientId,
      metadata: { prefix: key.prefix, before: { label: key.label ?? null, scopes: key.scopes ?? "all" }, after: { label: label ?? null, scopes: scopes ?? key.scopes ?? "all" } },
    });
    return null;
  },
});

// Returns every key with this prefix (normally zero or one). Legacy 32-bit
// prefixes could collide, so the caller matches on the full hash.
export const _getByPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_prefix", (q) => q.eq("prefix", args.prefix))
      .take(5);
  },
});

export const _touchLastUsed = internalMutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.apiKeyId);
    const now = Date.now();
    if (!key || (key.lastUsedAt !== undefined && now - key.lastUsedAt < LAST_USED_WRITE_INTERVAL_MS)) {
      return null;
    }
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: now });
    return null;
  },
});

export const _getClientById = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.clientId);
  },
});

// ── Auth result shape used by http.ts ──────────────────────────
export type ApiKeyAuthResult =
  | {
      ok: true;
      clientId: Id<"clients">;
      apiKeyId: Id<"apiKeys">;
      plan: "trial" | "starter" | "growth" | "business" | "enterprise";
      environment: "live" | "test";
      rpmCap: number;
      // null = every scope (a key from before scopes existed).
      scopes: string[] | null;
    }
  | { ok: false; status: number; error: string; prefix: string | null };

const INVALID_KEY = "Invalid API key";

// Called from httpActions. Takes the raw Authorization header value,
// looks up by prefix (indexed, cheap), hashes the full presented key,
// and compares against the stored hash. The prefix is public information
// (shown in dashboards); only the secret suffix is sensitive. Unknown,
// mismatched and revoked keys all get the same response so callers can't
// tell which prefixes exist.
export async function authenticateApiKey(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  authHeader: string | null,
): Promise<ApiKeyAuthResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header", prefix: null };
  }

  const rawKey = authHeader.slice("Bearer ".length).trim();
  const prefix = parseApiKeyPrefix(rawKey);
  if (!prefix) {
    return { ok: false, status: 401, error: INVALID_KEY, prefix: null };
  }

  const candidates: Doc<"apiKeys">[] = await ctx.runQuery(internal.apiKeys._getByPrefix, { prefix });
  const presentedHash = await sha256Hex(rawKey);
  const keyRow = candidates.find((row) => safeCompareHex(presentedHash, row.hashedKey));
  // Revoked keys, and rotated keys past their grace period, are invalid.
  if (!keyRow || !keyIsUsable(keyRow)) {
    return { ok: false, status: 401, error: INVALID_KEY, prefix };
  }

  // A suspended / expired client's keys must not work.
  const client: Doc<"clients"> | null = await ctx.runQuery(internal.apiKeys._getClientById, {
    clientId: keyRow.clientId,
  });
  if (!client) {
    return { ok: false, status: 401, error: INVALID_KEY, prefix };
  }
  if (client.status !== "active") {
    return { ok: false, status: 403, error: `Account is ${client.status}`, prefix };
  }

  // Awaited: an un-awaited mutation in an httpAction may never run.
  await ctx.runMutation(internal.apiKeys._touchLastUsed, { apiKeyId: keyRow._id });

  return {
    ok: true,
    clientId: keyRow.clientId,
    apiKeyId: keyRow._id,
    plan: client.plan,
    environment: keyRow.environment,
    rpmCap: client.rpmCap,
    scopes: keyRow.scopes ?? null,
  };
}

// Scope a route needs (http.ts).
export function scopeForRoute(route: string): ApiScope | null {
  if (route === "POST /v1/verify/idp") return "verify:kyc";
  if (route === "POST /v1/verify/aml") return "verify:aml";
  if (route === "POST /v1/verify/document") return "verify:document";
  if (route === "POST /v1/verify/kyb") return "verify:kyb";
  if (route.includes("/v1/capture-links")) return "capture";
  if (route.includes("/v1/monitoring/") || route.startsWith("POST /v1/transactions")) return "monitoring";
  if (route.startsWith("GET /v1/verify")) return "results:read";
  if (route.startsWith("GET /v1/credits")) return "credits:read";
  return null;
}

export function keyAllowsRoute(scopes: string[] | null, route: string): boolean {
  if (scopes === null) return true;
  const needed = scopeForRoute(route);
  return needed === null || scopes.includes(needed);
}

// The client's API IP allowlist, when they apply it to the API.
export const _apiIpRules = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const { security } = await loadClientSettings(ctx, args.clientId);
    return security.ipAllowlistApi ? security.ipAllowlist : [];
  },
});
