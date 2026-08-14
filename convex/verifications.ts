import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { buildVerificationReference } from "./lib/crypto";

export const _create = internalMutation({
  args: {
    clientId: v.id("clients"),
    type: v.union(
      v.literal("idp"),
      v.literal("kyb"),
      v.literal("aml"),
      v.literal("liveness"),
    ),
    input: v.any(),
    creditsUsed: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: args.type,
      status: "queued",
      creditsUsed: args.creditsUsed,
      input: args.input,
      reference,
      createdAt: now,
      updatedAt: now,
    });
    return { id, reference };
  },
});

export const _markProcessing = internalMutation({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "processing", updatedAt: Date.now() });
  },
});

export const _complete = internalMutation({
  args: {
    id: v.id("verifications"),
    verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    confidence: v.number(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "completed",
      verdict: args.verdict,
      confidence: args.confidence,
      result: args.result,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
  },
});

export const _fail = internalMutation({
  args: { id: v.id("verifications"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      failureReason: args.reason,
      updatedAt: Date.now(),
    });
  },
});

// verification status AND creates the corresponding reviewQueue row.
export const _completeWithReview = internalMutation({
  args: {
    id: v.id("verifications"),
    clientId: v.id("clients"),
    result: v.any(),
    triggerType: v.union(
      v.literal("client_dispute"),
      v.literal("auto_escalation"),
      v.literal("internal_flag"),
    ),
    triggerReason: v.string(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "completed",
      verdict: "review",
      result: args.result,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    await ctx.db.insert("reviewQueue", {
      verificationId: args.id,
      clientId: args.clientId,
      triggerType: args.triggerType,
      triggerReason: args.triggerReason,
      priority: args.priority,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// Tenant-isolation:A client must never be able to fetch another client's verification..
export const _getByReferenceForClient = internalQuery({
  args: { reference: v.string(), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("verifications")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .unique();
    if (!row || row.clientId !== args.clientId) return null;
    return row;
  },
});

export const _getById = internalQuery({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});