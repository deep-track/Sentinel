import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";

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
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    const matchingRows = rows
      .filter((row) => args.before === undefined || row.createdAt < args.before)
      .sort((a, b) => b.createdAt - a.createdAt);
    const entries = matchingRows.slice(0, limit);

    return {
      entries,
      nextCursor:
        matchingRows.length > entries.length
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
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    return rows.reduce((sum, r) => sum + r.amount, 0);
  },
});
