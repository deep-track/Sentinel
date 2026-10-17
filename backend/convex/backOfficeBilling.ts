import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { recordAudit } from "./auditLog";
import { getBalance } from "./lib/credits";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { demoClientIds, withoutDemo } from "./lib/demo";
import { BILLING_CURRENCIES, creditsToMoney, PLANS, toUsd, type BillingCurrency } from "./lib/pricing";

// Sentinel Back Office: revenue and billing. Usage = deductions minus refunds
// in the credit ledger. Revenue = credits used x what a credit is worth on the
// client's plan, in the client's billing currency (USD or KES, lib/pricing.ts).
// Totals are kept per currency; the USD→KES rate in billingSettings adds a
// combined USD figure.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 500;
const MAX_LEDGER_ROWS_PER_CLIENT = 5_000;
const MAX_OPEN_REVIEWS = 500;
const MAX_STATEMENT_ROWS = 2_000;
const FORECAST_WINDOW_DAYS = 14;
export const LOW_BALANCE_DAYS = 7;

export const MAX_USD_TO_KES = 10_000;

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

async function loadSettings(ctx: QueryCtx) {
  return await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
}

function currencyOf(client: Pick<Doc<"clients">, "billingCurrency">): BillingCurrency {
  return client.billingCurrency ?? "USD";
}

export const overview = query({
  // monthStarts: start of each month to report, oldest first, in the
  // viewer's timezone (queries must not read the clock).
  args: { now: v.number(), monthStarts: v.array(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const monthStarts = [...args.monthStarts].sort((a, b) => a - b).slice(-12);
    if (monthStarts.length === 0) throw new ConvexError({ code: "invalid_argument", message: "monthStarts is required." });
    const settings = await loadSettings(ctx);
    const usdToKes = settings?.usdToKes ?? null;
    const forecastFrom = args.now - FORECAST_WINDOW_DAYS * DAY_MS;
    const from = Math.min(monthStarts[0], forecastFrom);

    // Demo Bank Ltd (the demo organization) is left out of usage and revenue.
    const demo = await demoClientIds(ctx);
    const clients = (await ctx.db.query("clients").take(MAX_CLIENTS)).filter((client) => !demo.has(client._id));
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
        // Revenue from the money recorded on each charge (rows from before
        // currency pricing have none and count as 0).
        const revenueByMonth = monthStarts.map(() => 0);
        let lastWindow = 0;
        for (const row of rows) {
          const used = creditsUsed(row);
          const index = monthIndex(row.createdAt);
          if (index >= 0) {
            byMonth[index] += used;
            if ((row.type === "deduction" || row.type === "refund") && row.value !== undefined && row.currency === currencyOf(client)) {
              revenueByMonth[index] -= row.value;
            }
          }
          if (row.createdAt >= forecastFrom) lastWindow += used;
        }
        const balance = await getBalance(ctx, client._id);
        return {
          _id: client._id,
          name: client.name,
          plan: client.plan,
          status: client.status,
          billingCurrency: currencyOf(client),
          balance,
          balanceValue: creditsToMoney(balance, currencyOf(client), client.plan),
          creditsByMonth: byMonth.map((value) => Math.max(0, value)),
          revenueByMonth: revenueByMonth.map((value) => Math.max(0, Math.round(value * 100) / 100)),
          usedLast14Days: Math.max(0, lastWindow),
          daysLeft: client.status === "active" ? daysUntilEmpty(balance, Math.max(0, lastWindow), FORECAST_WINDOW_DAYS) : null,
          truncated: rows.length === MAX_LEDGER_ROWS_PER_CLIENT,
        };
      }),
    );

    // Work done but not yet charged: open review items whose verification
    // has no deduction yet (charged when the review is resolved).
    const open = withoutDemo(
      (
        await Promise.all(
          (["pending", "in_review"] as const).map((status) =>
            ctx.db.query("reviewQueue").withIndex("by_status_and_created_at", (q) => q.eq("status", status)).take(MAX_OPEN_REVIEWS),
          ),
        )
      ).flat(),
      demo,
    );
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
          return {
            reviewId: item._id,
            clientName: client?.name ?? "Unknown client",
            reference: verification.reference,
            type: verification.type,
            credits: verification.creditsUsed,
            amount: client ? creditsToMoney(verification.creditsUsed, currencyOf(client), client.plan) : null,
            currency: client ? currencyOf(client) : ("USD" as BillingCurrency),
            openedAt: item.createdAt,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    const totalsByMonth = monthStarts.map((start, index) => {
      const byCurrency = Object.fromEntries(
        BILLING_CURRENCIES.map((currency) => [
          currency,
          Math.round(
            perClient
              .filter((client) => client.billingCurrency === currency)
              .reduce((sum, client) => sum + client.revenueByMonth[index], 0) * 100,
          ) / 100,
        ]),
      ) as Record<BillingCurrency, number>;
      const kesInUsd = toUsd(byCurrency.KES, "KES", usdToKes);
      return {
        monthStart: start,
        credits: perClient.reduce((sum, client) => sum + client.creditsByMonth[index], 0),
        revenueByCurrency: byCurrency,
        // Combined, in USD; null while there is KES revenue and no rate is set.
        revenue: byCurrency.KES === 0 ? byCurrency.USD : kesInUsd === null ? null : Math.round((byCurrency.USD + kesInUsd) * 100) / 100,
      };
    });

    return {
      pricing: { currency: "USD", usdToKes, updatedAt: settings?.updatedAt ?? null },
      monthStarts,
      totalsByMonth,
      clients: perClient.sort((a, b) => (b.creditsByMonth.at(-1) ?? 0) - (a.creditsByMonth.at(-1) ?? 0)),
      lowBalance: perClient
        .filter((client) => client.daysLeft !== null && client.daysLeft <= LOW_BALANCE_DAYS * 2)
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
      unbilled: unbilled.sort((a, b) => a.openedAt - b.openedAt),
      unbilledCredits: unbilled.reduce((sum, row) => sum + row.credits, 0),
      unbilledByCurrency: Object.fromEntries(
        BILLING_CURRENCIES.map((currency) => [
          currency,
          Math.round(unbilled.filter((row) => row.currency === currency).reduce((sum, row) => sum + (row.amount ?? 0), 0) * 100) / 100,
        ]),
      ) as Record<BillingCurrency, number>,
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
    const settings = await loadSettings(ctx);
    const usdToKes = settings?.usdToKes ?? null;
    const currency = currencyOf(client);
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
      client: { name: client.name, plan: client.plan, billingCurrency: currency },
      currency,
      usdToKes,
      lines: lines.map((line, index) => ({ ...line, value: rows[index].value ?? null })),
      totals: {
        creditsUsed: Math.max(0, used),
        added: rows.filter((row) => row.type === "allocation" || (row.type === "adjustment" && row.amount > 0)).reduce((sum, row) => sum + row.amount, 0),
        // Charges less refunds, from the money recorded on each row.
        amountDue: Math.max(
          0,
          Math.round(
            rows
              .filter((row) => (row.type === "deduction" || row.type === "refund") && row.value !== undefined && row.currency === currency)
              .reduce((sum, row) => sum - (row.value ?? 0), 0) * 100,
          ) / 100,
        ),
        unpricedLines: rows.filter((row) => row.value === undefined).length,
      },
      truncated: rows.length === MAX_STATEMENT_ROWS,
    };
  },
});

// USD → KES rate used to show and charge KES-billed clients.
export const setExchangeRate = mutation({
  args: { usdToKes: v.number() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    if (!Number.isFinite(args.usdToKes) || args.usdToKes <= 0 || args.usdToKes > MAX_USD_TO_KES) {
      throw new ConvexError({ code: "invalid_argument", message: `The USD → KES rate must be between 0 and ${MAX_USD_TO_KES}.` });
    }
    const usdToKes = Math.round(args.usdToKes * 10_000) / 10_000;
    const existing = await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { usdToKes, updatedAt: now, updatedBy: actorId });
    else await ctx.db.insert("billingSettings", { key: "default", usdToKes, updatedAt: now, updatedBy: actorId });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "billing.exchange_rate_updated",
      targetType: "billingSettings",
      targetId: "default",
      metadata: { before: existing?.usdToKes ?? null, after: usdToKes },
    });
  },
});

// The plans and prices (lib/pricing.ts), for the Back Office price list.
export const priceList = query({
  args: {},
  handler: async (ctx) => {
    await requireInternalUser(ctx);
    const settings = await loadSettings(ctx);
    return { plans: PLANS, usdToKes: settings?.usdToKes ?? null };
  },
});
