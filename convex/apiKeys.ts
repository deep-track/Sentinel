import { v, ConvexError } from "convex/values";
import { action, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildRawApiKey, sha256Hex, safeCompareHex } from "./lib/crypto";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
    }
    return await ctx.db.insert("clients", {
      name: args.name,
      plan: args.plan,
      status: "active",
      creditLimit: args.creditLimit,
      rpmCap: args.rpmCap,
      creditThresholdPct: 80,
      createdAt: Date.now(),
    });
  },
});

// generate a new key for a client
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

    // rawKey is returned ONCE only the hash is stored
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

// Auth result shape used by http.ts
export type ApiKeyAuthResult =
  | { ok: true; clientId: Id<"clients">; apiKeyId: Id<"apiKeys"> }
  | { ok: false; status: number; error: string };

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

  ctx.runMutation(internal.apiKeys._touchLastUsed, { apiKeyId: keyRow._id });

  return { ok: true, clientId: keyRow.clientId, apiKeyId: keyRow._id };
}