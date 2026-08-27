import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { buildVerificationReference } from "./lib/crypto";
import { isInternalAdmin, requireClientRole, requireInternalUser } from "./lib/rbac";

const verificationType = v.union(v.literal("idp"), v.literal("kyb"), v.literal("aml"), v.literal("liveness"));
const verificationVerdict = v.union(v.literal("pass"), v.literal("review"), v.literal("reject"));

async function accessibleClientIds(ctx: { db: any; auth: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  if (await isInternalAdmin(ctx)) {
    return (await ctx.db.query("clients").collect()).filter((client: any) => client.status === "active").map((client: any) => client._id);
  }
  const memberships = await ctx.db.query("clientMembers").withIndex("by_user", (q: any) => q.eq("userId", identity.subject)).collect();
  const ids = [];
  for (const membership of memberships) {
    if (!membership.isActive) continue;
    const client = await ctx.db.get(membership.clientId);
    if (client?.status === "active") ids.push(client._id);
  }
  if (!ids.length) throw new ConvexError({ code: "forbidden", message: "No active client membership." });
  return ids;
}

/** Public read boundary used by authenticated platform pages. */
export const list = query({
  args: { type: v.optional(verificationType), limit: v.optional(v.number()), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const clientIds = await accessibleClientIds(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const rows = (await Promise.all(clientIds.map((clientId: any) => ctx.db.query("verifications").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect()))).flat()
      .filter((row: any) => (!args.type || row.type === args.type) && (args.before === undefined || row.createdAt < args.before))
      .sort((a: any, b: any) => b.createdAt - a.createdAt);
    return { records: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].createdAt : null };
  },
});

export const get = query({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const clientIds = await accessibleClientIds(ctx);
    return clientIds.some((clientId: any) => clientId === row.clientId) ? row : null;
  },
});

export const create = mutation({
  args: { clientId: v.id("clients"), type: verificationType, input: v.any(), creditsUsed: v.number() },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    if (!Number.isFinite(args.creditsUsed) || args.creditsUsed < 0) throw new ConvexError({ code: "invalid_argument", message: "Invalid credit amount." });
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", { clientId: args.clientId, type: args.type, status: "queued", creditsUsed: args.creditsUsed, input: args.input, reference, createdAt: now, updatedAt: now });
    return { id, reference };
  },
});

export const review = mutation({
  args: { id: v.id("verifications"), verdict: verificationVerdict, notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const reviewer = await requireInternalUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new ConvexError({ code: "not_found", message: "Verification not found." });
    const now = Date.now();
    await ctx.db.patch(args.id, { status: "completed", verdict: args.verdict, result: { ...(row.result ?? {}), reviewNotes: args.notes ?? null, reviewedBy: reviewer }, updatedAt: now, completedAt: now });
    return { reviewed: true };
  },
});

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

// verification status
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

// Tenant-isolation
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

export const _listForClient = internalQuery({
  args: {
    clientId: v.id("clients"),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    type: v.optional(
      v.union(
        v.literal("idp"),
        v.literal("kyb"),
        v.literal("aml"),
        v.literal("liveness"),
      ),
    ),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    const matchingRows = rows
      .filter((row) =>
        (!args.status || row.status === args.status) &&
        (!args.type || row.type === args.type) &&
        (args.before === undefined || row.createdAt < args.before),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const records = matchingRows.slice(0, limit);

    return {
      records,
      nextCursor:
        matchingRows.length > records.length
          ? records[records.length - 1]?.createdAt
          : null,
    };
  },
});

export const _getById = internalQuery({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
