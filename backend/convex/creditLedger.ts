import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

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
