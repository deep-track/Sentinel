import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildRawApiKey, parseApiKeyPrefix, sha256Hex, safeCompareHex } from "./lib/crypto";
import { requireClientRole, requireInternalAdmin } from "./lib/rbac";
import { recordLedgerEntry } from "./lib/credits";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import type { Doc, Id } from "./_generated/dataModel";

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
      v.literal("enterprise"),
    ),
    creditLimit: v.number(),
    rpmCap: v.number(),
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
      metadata: { name, plan: args.plan, creditLimit: args.creditLimit, rpmCap: args.rpmCap },
    });
    return clientId;
  },
});

export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(MAX_KEYS_LISTED);
    return keys.map((key) => ({ _id: key._id, prefix: key.prefix, environment: key.environment, revoked: key.revoked, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt }));
  },
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError({ code: "not_found", message: "API key not found." });
    const actor = await requireClientRole(ctx, key.clientId, ["client_admin"]);
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
    });
    return { keyId, rawKey, prefix };
  }
  throw new ConvexError({ code: "internal", message: "Could not allocate a unique API key. Please try again." });
}

// rawKey is returned ONCE. Only the hash is stored, so the caller must show
// it to the user immediately and never log it.
export const createForClient = mutation({
  args: { clientId: v.id("clients"), environment: v.union(v.literal("live"), v.literal("test")) },
  handler: async (ctx, args) => {
    // requireClientRole also rejects inactive clients for writes.
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const { keyId, rawKey, prefix } = await insertUniqueApiKey(ctx, args.clientId, args.environment);
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "api_key.created",
      targetType: "api_key",
      targetId: keyId,
      clientId: args.clientId,
      metadata: { prefix, environment: args.environment },
    });
    return { rawKey, prefix };
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
      plan: "trial" | "starter" | "growth" | "enterprise";
      environment: "live" | "test";
      rpmCap: number;
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
  if (!keyRow || keyRow.revoked) {
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
  };
}
