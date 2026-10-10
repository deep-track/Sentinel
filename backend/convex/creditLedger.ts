import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireClientRole } from "./lib/rbac";
import { chargeVerification, getBalance, recordLedgerEntry } from "./lib/credits";

const ledgerType = v.union(
  v.literal("allocation"),
  v.literal("deduction"),
  v.literal("refund"),
  v.literal("adjustment"),
);

// Kept for existing callers. Deductions tied to a verification go through the
// idempotent charge, so a retry or a review resolution can't bill the same
// verification twice; everything else is a plain ledger entry. Both paths
// keep clients.creditBalance in sync.
export const _insertLedgerEntry = internalMutation({
  args: {
    clientId: v.id("clients"),
    verificationId: v.optional(v.id("verifications")),
    type: ledgerType,
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.type === "deduction" && args.verificationId) {
      await chargeVerification(ctx, {
        clientId: args.clientId,
        verificationId: args.verificationId,
        amount: Math.abs(args.amount),
        reason: args.reason,
      });
      return null;
    }
    await recordLedgerEntry(ctx, args);
    return null;
  },
});

export const _getBalance = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => await getBalance(ctx, args.clientId),
});

export const _getLedgerHistory = internalQuery({
  args: {
    clientId: v.id("clients"),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_client_created_at", (q) => {
        const byClient = q.eq("clientId", args.clientId);
        return args.before === undefined ? byClient : byClient.lt("createdAt", args.before);
      })
      .order("desc")
      .take(limit + 1);
    const entries = rows.slice(0, limit);

    return {
      entries,
      nextCursor:
        rows.length > entries.length
          ? entries[entries.length - 1]?.createdAt
          : null,
    };
  },
});

export const getBalanceForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, [
      "client_admin",
      "compliance_analyst",
      "developer",
      "viewer",
    ]);
    return await getBalance(ctx, args.clientId);
  },
});

const BACKFILL_BATCH_SIZE = 20;

// One-off migration for clients created before allocations were recorded:
// writes an "allocation" entry for `creditLimit` (once per client) and seeds
// clients.creditBalance. Idempotent; processes clients in batches and
// re-schedules itself until done. Run after deploy:
//   npx convex run creditLedger:backfillAllocations
export const backfillAllocations = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("clients")
      .paginate({ numItems: BACKFILL_BATCH_SIZE, cursor: args.cursor ?? null });

    let allocated = 0;
    for (const client of page.page) {
      const existingAllocation = await ctx.db
        .query("creditLedger")
        .withIndex("by_client", (q) => q.eq("clientId", client._id))
        .filter((q) => q.eq(q.field("type"), "allocation"))
        .first();
      if (!existingAllocation && client.creditLimit > 0) {
        await recordLedgerEntry(ctx, {
          clientId: client._id,
          type: "allocation",
          amount: client.creditLimit,
          reason: `Plan credit allocation (${client.plan}) — backfill`,
        });
        allocated += 1;
      } else if (client.creditBalance === undefined) {
        await ctx.db.patch(client._id, { creditBalance: await getBalance(ctx, client._id) });
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.creditLedger.backfillAllocations, {
        cursor: page.continueCursor,
      });
    }
    return { processed: page.page.length, allocated, done: page.isDone };
  },
});
