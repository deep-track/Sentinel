import { v } from "convex/values";
import { action, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildRawApiKey, sha256Hex, safeCompareHex } from "./lib/crypto";
import { requireInternalUser } from "./lib/rbac";
import type { Id } from "./_generated/dataModel";

// Bootstraps a new tenant. Gated behind a signed-in Convex Auth user
// (dashboard-only, same as notes.create) — this is NOT part of the
// public /v1 API. Anyone hitting this without a session is rejected.
// Tighten further with an admin-role check once you have roles.
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
    await requireInternalUser(ctx);
    return await ctx.db.insert("clients", {
      name: args.name,
      plan: args.plan,
      status: "active",
      creditLimit: args.creditLimit,
      rpmCap: args.rpmCap,
      creditThresholdPct: 80, // Section 1.1 default — override per-client later via a settings mutation
      createdAt: Date.now(),
    });
  },
});

// ── Public: generate a new key for a client ────────────────────
// Call this from your (authenticated, internal-dashboard-only) UI.
// This is NOT the public /v1 API — this creates keys, it doesn't
// consume them. Gate this behind whatever admin/dashboard auth you
// already have via Convex Auth before calling it.
export const generateApiKey = action({
  args: {
    clientId: v.id("clients"),
    environment: v.union(v.literal("live"), v.literal("test")),
  },
  handler: async (ctx, args): Promise<{ rawKey: string; prefix: string }> => {
    const { rawKey, prefix } = buildRawApiKey(args.environment);
    const hashedKey = await sha256Hex(rawKey);

    await ctx.runMutation(internal.apiKeys._insert, {
      clientId: args.clientId,
      prefix,
      hashedKey,
      environment: args.environment,
    });

    // rawKey is returned ONCE. Nothing after this point can recover it —
    // only the hash is stored. Make sure your caller surfaces this to
    // the client immediately and doesn't log it anywhere.
    return { rawKey, prefix };
  },
});

export const _insert = internalMutation({
  args: {
    clientId: v.id("clients"),
    prefix: v.string(),
    hashedKey: v.string(),
    environment: v.union(v.literal("live"), v.literal("test")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiKeys", {
      clientId: args.clientId,
      prefix: args.prefix,
      hashedKey: args.hashedKey,
      environment: args.environment,
      revoked: false,
      createdAt: Date.now(),
    });
  },
});

export const _getByPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_prefix", (q) => q.eq("prefix", args.prefix))
      .unique();
  },
});

export const _touchLastUsed = internalMutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: Date.now() });
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
    }
  | { ok: false; status: number; error: string };

// Called from httpActions. Takes the raw Authorization header value,
// looks up by prefix (indexed, cheap), hashes the full presented key,
// and compares against the stored hash. Never queries by hashedKey
// directly off untrusted input in a way that would allow timing
// enumeration of prefixes — prefix lookup is intentionally public
// information (it's shown in dashboards), only the secret suffix
// is sensitive.
export async function authenticateApiKey(
  ctx: { runQuery: any; runMutation: any },
  authHeader: string | null,
): Promise<ApiKeyAuthResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header" };
  }

  const rawKey = authHeader.slice("Bearer ".length).trim();
  const parts = rawKey.split("_");
  if (parts.length < 3 || parts[0] !== "gt") {
    return { ok: false, status: 401, error: "Malformed API key" };
  }
  const prefix = `${parts[0]}_${parts[1]}_${parts[2].slice(0, 8)}`;

  const keyRow = await ctx.runQuery(internal.apiKeys._getByPrefix, { prefix });
  if (!keyRow) {
    return { ok: false, status: 401, error: "Invalid API key" };
  }
  if (keyRow.revoked) {
    return { ok: false, status: 401, error: "This API key has been revoked" };
  }

  const presentedHash = await sha256Hex(rawKey);
  if (!safeCompareHex(presentedHash, keyRow.hashedKey)) {
    return { ok: false, status: 401, error: "Invalid API key" };
  }

  // Previously missing entirely: a suspended client's keys still
  // worked. Section 4.1 lists client status as active/suspended/
  // trial_expired specifically so it can gate access — now it does.
  const client = await ctx.runQuery(internal.apiKeys._getClientById, {
    clientId: keyRow.clientId,
  });
  if (!client) {
    return { ok: false, status: 401, error: "Invalid API key" };
  }
  if (client.status !== "active") {
    return { ok: false, status: 403, error: `Account is ${client.status}` };
  }

  // Fire-and-forget last-used tracking — don't block the request on it.
  ctx.runMutation(internal.apiKeys._touchLastUsed, { apiKeyId: keyRow._id });

  return { ok: true, clientId: keyRow.clientId, apiKeyId: keyRow._id, plan: client.plan };
}