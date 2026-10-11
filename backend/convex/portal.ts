import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { getBalance } from "./lib/credits";
import { requireClientRole } from "./lib/rbac";

// Read caps so the portal stays within Convex query limits as data grows.
// When a cap is hit the figures cover the newest rows only (`truncated`).
const MAX_MONTH_ROWS = 5000;
const MAX_LEDGER_ROWS = 5000;
const MAX_API_KEY_ROWS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

// Display name for a verification's subject, when the input has one.
export function subjectOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (typeof value.subjectName === "string" && value.subjectName.trim()) return value.subjectName;
  if (typeof value.companyName === "string" && value.companyName.trim()) return value.companyName;
  const name = [value.firstName, value.lastName].filter((part) => typeof part === "string" && part.trim()).join(" ");
  return name || null;
}

export function latencyStats(rows: Doc<"verifications">[]) {
  const latencies = rows
    .filter((row) => row.status === "completed" && row.completedAt !== undefined)
    .map((row) => (row.completedAt as number) - row.createdAt)
    .filter((ms) => ms >= 0)
    .sort((left, right) => left - right);
  if (latencies.length === 0) return { avgMs: null, p95Ms: null };
  const avgMs = latencies.reduce((total, ms) => total + ms, 0) / latencies.length;
  const p95Ms = latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)];
  return { avgMs, p95Ms };
}

// Client portal overview for one organization. `monthStart` / `dayStart` come
// from the browser so "this month" and "today" follow the viewer's timezone
// (queries must not read the wall clock).
export const overview = query({
  args: {
    clientId: v.id("clients"),
    monthStart: v.number(),
    dayStart: v.number(),
    recentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;

    // Clamp the window so a bad argument can't scan more than ~a month.
    const monthStart = Math.max(args.monthStart, args.dayStart - 32 * DAY_MS);
    const recentLimit = Math.min(Math.max(Math.floor(args.recentLimit ?? 25), 1), 100);

    const monthRows = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId).gte("createdAt", monthStart))
      .order("desc")
      .take(MAX_MONTH_ROWS);
    // Recent rows may predate this month on a quiet account.
    const recentRows =
      monthRows.length >= recentLimit
        ? monthRows.slice(0, recentLimit)
        : await ctx.db
            .query("verifications")
            .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId))
            .order("desc")
            .take(recentLimit);

    const ledger = await ctx.db
      .query("creditLedger")
      .withIndex("by_client_created_at", (q) => q.eq("clientId", args.clientId).gte("createdAt", monthStart))
      .take(MAX_LEDGER_ROWS);
    // Deductions are stored as negative amounts; refunds give credits back.
    const creditsUsedThisMonth = Math.max(
      0,
      ledger.reduce((total, entry) => {
        if (entry.type === "deduction") return total + Math.abs(entry.amount);
        if (entry.type === "refund") return total - Math.abs(entry.amount);
        return total;
      }, 0),
    );

    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .take(MAX_API_KEY_ROWS);

    const flagged = monthRows.filter((row) => row.verdict === "review" || row.verdict === "reject").length;

    return {
      client: {
        name: client.name,
        plan: client.plan,
        status: client.status,
        creditLimit: client.creditLimit,
        creditThresholdPct: client.creditThresholdPct,
      },
      credits: { balance: await getBalance(ctx, args.clientId), usedThisMonth: creditsUsedThisMonth },
      scans: {
        thisMonth: monthRows.length,
        today: monthRows.filter((row) => row.createdAt >= args.dayStart).length,
      },
      latency: latencyStats(monthRows),
      flagged: {
        count: flagged,
        pct: monthRows.length ? Math.round((flagged / monthRows.length) * 1000) / 10 : 0,
      },
      apiKeys: {
        active: apiKeys.filter((key) => !key.revoked).length,
        revoked: apiKeys.filter((key) => key.revoked).length,
      },
      recent: recentRows.map((row) => ({
        reference: row.reference,
        type: row.type,
        subject: subjectOf(row.input),
        status: row.status,
        verdict: row.verdict ?? null,
        confidence: row.confidence ?? null,
        createdAt: row.createdAt,
      })),
      truncated: monthRows.length === MAX_MONTH_ROWS || ledger.length === MAX_LEDGER_ROWS,
    };
  },
});
