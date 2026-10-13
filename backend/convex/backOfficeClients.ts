import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireInternalUser } from "./lib/rbac";

// Sentinel Back Office: client health. Usage trends and churn warnings, API
// key hygiene, integration errors, onboarding progress and client teams.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 8;
const MAX_CLIENTS = 500;
const MAX_TRAFFIC_ROWS = 10_000;
const MAX_ERRORS_PER_CLIENT = 2_000;
const MAX_FIRST_SCAN = 500;
const API_ERROR_RETENTION_MS = 30 * DAY_MS;
// A key unused for this long, or older than this, needs attention.
export const KEY_IDLE_DAYS = 30;
export const KEY_ROTATE_DAYS = 180;
// Churn warning: last 14 days at least this much below the 14 days before,
// for a client with at least this many verifications in that earlier window.
export const CHURN_DROP_RATIO = 0.5;
export const CHURN_MIN_BASELINE = 10;

export const _logApiError = internalMutation({
  args: {
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    route: v.string(),
    status: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiErrors", { ...args, route: args.route.slice(0, 80), at: Date.now() });
  },
});

export const purgeApiErrors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - API_ERROR_RETENTION_MS;
    const expired = await ctx.db.query("apiErrors").withIndex("by_at", (q) => q.lt("at", cutoff)).take(500);
    for (const row of expired) await ctx.db.delete(row._id);
  },
});

// Pure helpers (exported for tests).

export function churnRisk(last14: number, previous14: number): boolean {
  return previous14 >= CHURN_MIN_BASELINE && last14 <= previous14 * (1 - CHURN_DROP_RATIO);
}

export function keyFlags(key: Pick<Doc<"apiKeys">, "revoked" | "createdAt" | "lastUsedAt">, now: number): string[] {
  if (key.revoked) return [];
  const flags: string[] = [];
  if (key.lastUsedAt === undefined) flags.push("never used");
  else if (now - key.lastUsedAt > KEY_IDLE_DAYS * DAY_MS) flags.push(`idle ${Math.floor((now - key.lastUsedAt) / DAY_MS)} days`);
  if (now - key.createdAt > KEY_ROTATE_DAYS * DAY_MS) flags.push("due for rotation");
  return flags;
}

function isSandbox(row: Doc<"verifications">) {
  return Boolean((row.input as { sandbox?: unknown } | null)?.sandbox);
}

export const clientHealth = query({
  // weekStarts: start of each of the last 8 weeks, oldest first, in the
  // viewer's timezone (queries must not read the clock).
  args: { now: v.number(), weekStarts: v.array(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const weekStarts = [...args.weekStarts].sort((a, b) => a - b).slice(-WEEKS);
    const from = Math.min(weekStarts[0] ?? args.now, args.now - 28 * DAY_MS);
    const clients = await ctx.db.query("clients").take(MAX_CLIENTS);

    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_created_at", (q) => q.gte("createdAt", from))
      .order("desc")
      .take(MAX_TRAFFIC_ROWS);
    const byClient = new Map<string, Doc<"verifications">[]>();
    for (const row of rows) {
      if (isSandbox(row)) continue;
      const list = byClient.get(row.clientId) ?? [];
      list.push(row);
      byClient.set(row.clientId, list);
    }
    const weekIndex = (at: number) => {
      for (let index = weekStarts.length - 1; index >= 0; index -= 1) if (at >= weekStarts[index]) return index;
      return -1;
    };
    const twoWeeksAgo = args.now - 14 * DAY_MS;
    const fourWeeksAgo = args.now - 28 * DAY_MS;

    const results = await Promise.all(
      clients.map(async (client) => {
        const traffic = byClient.get(client._id) ?? [];
        const weekly = weekStarts.map(() => 0);
        const byType: Record<string, number> = {};
        let last14 = 0;
        let previous14 = 0;
        for (const row of traffic) {
          const index = weekIndex(row.createdAt);
          if (index >= 0) weekly[index] += 1;
          if (row.createdAt >= twoWeeksAgo) {
            last14 += 1;
            byType[row.type] = (byType[row.type] ?? 0) + 1;
          } else if (row.createdAt >= fourWeeksAgo) previous14 += 1;
        }

        const keys = await ctx.db.query("apiKeys").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(100);
        const errors = await ctx.db
          .query("apiErrors")
          .withIndex("by_client_and_at", (q) => q.eq("clientId", client._id).gte("at", args.now - 7 * DAY_MS))
          .take(MAX_ERRORS_PER_CLIENT);
        const errorsByStatus: Record<string, number> = {};
        const errorsByRoute: Record<string, number> = {};
        for (const error of errors) {
          const bucket = error.status === 429 ? "429" : error.status >= 500 ? "5xx" : "4xx";
          errorsByStatus[bucket] = (errorsByStatus[bucket] ?? 0) + 1;
          errorsByRoute[error.route] = (errorsByRoute[error.route] ?? 0) + 1;
        }

        // Onboarding: first test call, first live verification, first charge.
        const firstScans = await ctx.db
          .query("verifications")
          .withIndex("by_client", (q) => q.eq("clientId", client._id))
          .order("asc")
          .take(MAX_FIRST_SCAN);
        const firstTest = firstScans.find(isSandbox)?.createdAt ?? null;
        const firstLive = firstScans.find((row) => !isSandbox(row))?.createdAt ?? null;
        const firstCharge = await ctx.db
          .query("creditLedger")
          .withIndex("by_client_created_at", (q) => q.eq("clientId", client._id))
          .filter((q) => q.eq(q.field("type"), "deduction"))
          .first();

        const members = await ctx.db.query("clientMembers").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(200);

        return {
          _id: client._id,
          name: client.name,
          plan: client.plan,
          status: client.status,
          createdAt: client.createdAt,
          usage: { weekly, last14, previous14, byType, churnRisk: churnRisk(last14, previous14) },
          keys: keys
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((key) => ({
              _id: key._id,
              prefix: key.prefix,
              environment: key.environment,
              revoked: key.revoked,
              createdAt: key.createdAt,
              lastUsedAt: key.lastUsedAt ?? null,
              flags: keyFlags(key, args.now),
            })),
          errors: {
            total: errors.length,
            byStatus: errorsByStatus,
            topRoutes: Object.entries(errorsByRoute)
              .map(([route, count]) => ({ route, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 3),
          },
          onboarding: {
            created: client.createdAt,
            firstKey: keys.length ? Math.min(...keys.map((key) => key.createdAt)) : null,
            firstTestCall: firstTest,
            firstLiveVerification: firstLive,
            firstCharge: firstCharge?.createdAt ?? null,
            paying: client.plan !== "trial" && firstCharge !== null,
          },
          team: members
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((member) => ({ userId: member.userId, role: member.role, isActive: member.isActive, since: member.createdAt })),
        };
      }),
    );

    return {
      weekStarts,
      truncated: rows.length === MAX_TRAFFIC_ROWS,
      clients: results.sort((a, b) => b.usage.last14 - a.usage.last14),
    };
  },
});
