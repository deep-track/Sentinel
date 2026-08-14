import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

// Never patch a balance field. Every movement is a new row; balance is
// always the sum of this table for a client, computed on read.

export const _insertLedgerEntry = internalMutation({
  args: {
    clientId: v.id("clients"),
    verificationId: v.optional(v.id("verifications")),
    type: v.union(
      v.literal("allocation"),
      v.literal("deduction"),
      v.literal("refund"),
      v.literal("adjustment"),
    ),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("creditLedger", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const _getBalance = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    return rows.reduce((sum, r) => sum + r.amount, 0);
  },
});

// Public read for GET /v1/credits — wired in http.ts. Left as a plain
// query too in case you want to call it from an authenticated Convex
// Auth session (e.g. an internal dashboard) rather than only via HTTP.
export const getBalanceForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    return rows.reduce((sum, r) => sum + r.amount, 0);
  },
});
