import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { recordAudit } from "./auditLog";
import { getBalance } from "./lib/credits";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";

// Sentinel Back Office: revenue and billing. Usage = deductions minus refunds
// in the credit ledger. Money = usage x the price per credit of the client's
// current plan, once prices are set in billingSettings.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 500;
const MAX_LEDGER_ROWS_PER_CLIENT = 5_000;
const MAX_OPEN_REVIEWS = 500;
const MAX_STATEMENT_ROWS = 2_000;
const FORECAST_WINDOW_DAYS = 14;
export const LOW_BALANCE_DAYS = 7;

type Plan = Doc<"clients">["plan"];
const PLANS: Plan[] = ["trial", "starter", "growth", "enterprise"];

// Credits consumed by one ledger row (deductions add, refunds give back).
export function creditsUsed(entry: Pick<Doc<"creditLedger">, "type" | "amount">): number {
  if (entry.type === "deduction") return Math.abs(entry.amount);
  if (entry.type === "refund") return -Math.abs(entry.amount);
  return 0;
}

// Days until the balance runs out at the recent daily rate; null when the
// client isn't using credits.
export function daysUntilEmpty(balance: number, usedInWindow: number, windowDays: number): number | null {
  const perDay = usedInWindow / windowDays;
  if (perDay <= 0) return null;
  return Math.max(0, Math.floor(balance / perDay));
}

async function loadPricing(ctx: QueryCtx) {
  return await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
}

export const overview = query({
  // monthStarts: start of each month to report, oldest first, in the
  // viewer's timezone (queries must not read the clock).
  args: { now: v.number(), monthStarts: v.array(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const monthStarts = [...args.monthStarts].sort((a, b) => a - b).slice(-12);
    if (monthStarts.length === 0) throw new ConvexError({ code: "invalid_argument", message: "monthStarts is required." });
    const pricing = await loadPricing(ctx);
    const priceFor = (plan: Plan) => pricing?.pricePerCredit[plan] ?? null;
    const forecastFrom = args.now - FORECAST_WINDOW_DAYS * DAY_MS;
    const from = Math.min(monthStarts[0], forecastFrom);

    const clients = await ctx.db.query("clients").take(MAX_CLIENTS);
    const monthIndex = (at: number) => {
      for (let index = monthStarts.length - 1; index >= 0; index -= 1) if (at >= monthStarts[index]) return index;
      return -1;
    };

    const perClient = await Promise.all(
      clients.map(async (client) => {
        const rows = await ctx.db
          .query("creditLedger")
          .withIndex("by_client_created_at", (q) => q.eq("clientId", client._id).gte("createdAt", from))
          .take(MAX_LEDGER_ROWS_PER_CLIENT);
        const byMonth = monthStarts.map(() => 0);
        let lastWindow = 0;
        for (const row of rows) {
          const used = creditsUsed(row);
          const index = monthIndex(row.createdAt);
          if (index >= 0) byMonth[index] += used;
          if (row.createdAt >= forecastFrom) lastWindow += used;
        }
        const balance = await getBalance(ctx, client._id);
        const price = priceFor(client.plan);
        return {
          _id: client._id,
          name: client.name,
          plan: client.plan,
          status: client.status,
          balance,
          creditsByMonth: byMonth.map((value) => Math.max(0, value)),
          revenueByMonth: price === null ? null : byMonth.map((value) => Math.max(0, value) * price),
          usedLast14Days: Math.max(0, lastWindow),
          daysLeft: client.status === "active" ? daysUntilEmpty(balance, Math.max(0, lastWindow), FORECAST_WINDOW_DAYS) : null,
          truncated: rows.length === MAX_LEDGER_ROWS_PER_CLIENT,
        };
      }),
    );

    // Work done but not yet charged: open review items whose verification
    // has no deduction yet (charged when the review is resolved).
    const open = (
      await Promise.all(
        (["pending", "in_review"] as const).map((status) =>
          ctx.db.query("reviewQueue").withIndex("by_status_and_created_at", (q) => q.eq("status", status)).take(MAX_OPEN_REVIEWS),
        ),
      )
    ).flat();
    const clientById = new Map(clients.map((client) => [client._id, client]));
    const unbilled = (
      await Promise.all(
        open.map(async (item) => {
          const charged = await ctx.db
            .query("creditLedger")
            .withIndex("by_verification", (q) => q.eq("verificationId", item.verificationId))
            .filter((q) => q.eq(q.field("type"), "deduction"))
            .first();
          if (charged) return null;
          const verification = await ctx.db.get(item.verificationId);
          if (!verification || verification.creditsUsed <= 0) return null;
          const client = clientById.get(item.clientId);
          const price = client ? priceFor(client.plan) : null;
          return {
            reviewId: item._id,
            clientName: client?.name ?? "Unknown client",
            reference: verification.reference,
            type: verification.type,
            credits: verification.creditsUsed,
            amount: price === null ? null : verification.creditsUsed * price,
            openedAt: item.createdAt,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    const totalsByMonth = monthStarts.map((start, index) => ({
      monthStart: start,
      credits: perClient.reduce((sum, client) => sum + client.creditsByMonth[index], 0),
      revenue: perClient.every((client) => client.revenueByMonth !== null)
        ? perClient.reduce((sum, client) => sum + (client.revenueByMonth?.[index] ?? 0), 0)
        : null,
    }));

    return {
      pricing: pricing
        ? { currency: pricing.currency, pricePerCredit: pricing.pricePerCredit, updatedAt: pricing.updatedAt }
        : null,
      monthStarts,
      totalsByMonth,
      clients: perClient.sort((a, b) => (b.creditsByMonth.at(-1) ?? 0) - (a.creditsByMonth.at(-1) ?? 0)),
      lowBalance: perClient
        .filter((client) => client.daysLeft !== null && client.daysLeft <= LOW_BALANCE_DAYS * 2)
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
      unbilled: unbilled.sort((a, b) => a.openedAt - b.openedAt),
      unbilledCredits: unbilled.reduce((sum, row) => sum + row.credits, 0),
    };
  },
});

// Ledger lines for one client and period, for a statement (CSV / print).
export const statement = query({
  args: { clientId: v.string(), from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const clientId = ctx.db.normalizeId("clients", args.clientId);
    const client = clientId ? await ctx.db.get(clientId) : null;
    if (!client || !clientId) return null;
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_client_created_at", (q) => q.eq("clientId", clientId).gte("createdAt", args.from).lt("createdAt", args.to))
      .take(MAX_STATEMENT_ROWS);
    const pricing = await loadPricing(ctx);
    const price = pricing?.pricePerCredit[client.plan] ?? null;
    const lines = await Promise.all(
      rows.map(async (row) => {
        const verification = row.verificationId ? await ctx.db.get(row.verificationId as Id<"verifications">) : null;
        return {
          createdAt: row.createdAt,
          type: row.type,
          amount: row.amount,
          reason: row.reason,
          reference: verification?.reference ?? null,
          verificationType: verification?.type ?? null,
        };
      }),
    );
    const used = rows.reduce((sum, row) => sum + creditsUsed(row), 0);
    return {
      client: { name: client.name, plan: client.plan },
      currency: pricing?.currency ?? null,
      pricePerCredit: price,
      lines,
      totals: {
        creditsUsed: Math.max(0, used),
        added: rows.filter((row) => row.type === "allocation" || (row.type === "adjustment" && row.amount > 0)).reduce((sum, row) => sum + row.amount, 0),
        amountDue: price === null ? null : Math.max(0, used) * price,
      },
      truncated: rows.length === MAX_STATEMENT_ROWS,
    };
  },
});

export const setPricing = mutation({
  args: {
    currency: v.string(),
    pricePerCredit: v.object({
      trial: v.optional(v.number()),
      starter: v.optional(v.number()),
      growth: v.optional(v.number()),
      enterprise: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const currency = args.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConvexError({ code: "invalid_argument", message: "Currency must be a three-letter code, e.g. KES or USD." });
    }
    for (const plan of PLANS) {
      const price = args.pricePerCredit[plan];
      if (price !== undefined && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) {
        throw new ConvexError({ code: "invalid_argument", message: `The ${plan} price must be between 0 and 1,000,000.` });
      }
    }
    const existing = await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const now = Date.now();
    const next = { key: "default" as const, currency, pricePerCredit: args.pricePerCredit, updatedAt: now, updatedBy: actorId };
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert("billingSettings", next);
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "billing.pricing_updated",
      targetType: "billingSettings",
      targetId: "default",
      metadata: {
        before: existing ? { currency: existing.currency, pricePerCredit: existing.pricePerCredit } : null,
        after: { currency, pricePerCredit: args.pricePerCredit },
      },
    });
  },
});
