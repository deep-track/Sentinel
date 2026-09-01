import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { buildVerificationReference } from "./lib/crypto";
import { isInternalAdmin, requireClientRole, requireInternalUser } from "./lib/rbac";

// The committed generated API is currently stale. Keep this cross-module
// reference compatible with both it and a freshly generated API.
const internalApi: any = internal;

const verificationType = v.union(v.literal("idp"), v.literal("kyb"), v.literal("aml"), v.literal("liveness"), v.literal("kyi"));
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
  args: {
    clientId: v.id("clients"),
    type: verificationType,
    input: v.any(),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") {
      throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    }
    const creditsUsed = creditsForType(args.type);

    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: args.type,
      status: "queued",
      creditsUsed,
      input: args.input,
      reference,
      createdAt: now,
      updatedAt: now,
    });
    // dispatches based on type.
    await dispatchProcessing(ctx, args.type, id, args.clientId, args.input);

    return { id, reference };
  },
});

function creditsForType(type: "idp" | "kyb" | "aml" | "liveness" | "kyi"): number {
  switch (type) {
    case "idp": return 1;
    case "kyi": return 1;
    case "kyb": return 3;
    case "aml": return 1;
    case "liveness": return 1;
  }
}

async function dispatchProcessing(
  ctx: any,
  type: "idp" | "kyb" | "aml" | "liveness" | "kyi",
  id: any,
  clientId: any,
  input: any,
) {
  switch (type) {
    case "idp": {
      const required = [
        "livenessFramesBase64", "livenessMediaType", "documentFrontBase64",
        "idNumber", "firstName", "lastName", "dateOfBirth", "gender",
      ];
      const missing = required.filter((k) => !input?.[k]);
      if (missing.length > 0) {
        // Fail loudly and immediately rather than sitting at "queued"
        // with no explanation — this is the fix for "the wizard
        // doesn't collect all required information" surfacing as a
        // silent hang instead of a clear error the frontend can show.
        await ctx.db.patch(id, {
          status: "failed",
          failureReason: `Missing required fields: ${missing.join(", ")}`,
          updatedAt: Date.now(),
        });
        return;
      }
      await ctx.scheduler.runAfter(0, internal.idp.processIdpVerification, {
        verificationId: id,
        clientId,
        livenessFramesBase64: input.livenessFramesBase64,
        livenessMediaType: input.livenessMediaType,
        documentFrontBase64: input.documentFrontBase64,
        documentBackBase64: input.documentBackBase64,
        idNumber: input.idNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
      });
      return;
    }
    case "kyi": {
  await ctx.db.patch(id, {
    status: "failed",
    failureReason: "Standalone KYI submissions aren't supported here",
    updatedAt: Date.now(),
  });
  return;
}
    case "kyb": {
      await ctx.scheduler.runAfter(0, internalApi.kyb.processKybVerification, {
        verificationId: id,
        clientId,
      });
      return;
    }
    case "liveness": {
      // Liveness is an invitation flow: it sends the subject a link and is
      // completed by the provider callback. It does not accept raw media via
      // this generic endpoint.
      await ctx.db.patch(id, {
        status: "failed",
        failureReason: "Use liveness.submit to create a liveness invitation.",
        updatedAt: Date.now(),
      });
      return;
    }
    case "aml": {
      await ctx.db.patch(id, {
        status: "failed",
        failureReason: "Standalone AML screening isn't available yet — AML runs as part of the IDP verification flow.",
        updatedAt: Date.now(),
      });
      return;
    }
  }
}

export const createKyc = mutation({
  args: {
    clientId: v.id("clients"),
    firstName: v.string(), lastName: v.string(), idNumber: v.string(), dateOfBirth: v.string(), gender: v.string(),
    documentType: v.union(v.literal("passport"), v.literal("id_card"), v.literal("driving_license")),
    documentFrontUrl: v.string(), documentBackUrl: v.optional(v.string()), documentFrontBase64: v.string(), documentBackBase64: v.optional(v.string()),
    selfieUrl: v.string(), selfieBase64: v.string(), livenessFramesBase64: v.string(), livenessMediaType: v.union(v.literal("jpeg_frames"), v.literal("mp4")),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const required = [args.firstName, args.lastName, args.idNumber, args.dateOfBirth, args.gender, args.documentFrontUrl, args.documentFrontBase64, args.selfieUrl, args.selfieBase64, args.livenessFramesBase64];
    if (required.some((field) => !field.trim())) throw new ConvexError({ code: "invalid_argument", message: "All identity, document, selfie, and liveness fields are required." });
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", { clientId: args.clientId, type: "idp", status: "queued", creditsUsed: 1, input: { firstName: args.firstName, lastName: args.lastName, idNumber: args.idNumber, dateOfBirth: args.dateOfBirth, gender: args.gender, documentType: args.documentType, documentFrontUrl: args.documentFrontUrl, documentBackUrl: args.documentBackUrl, selfieUrl: args.selfieUrl, livenessMediaType: args.livenessMediaType }, reference, createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.idp.processIdpVerification, { verificationId: id, clientId: args.clientId, livenessFramesBase64: args.livenessFramesBase64, livenessMediaType: args.livenessMediaType, documentFrontBase64: args.documentFrontBase64, documentBackBase64: args.documentBackBase64, idNumber: args.idNumber, firstName: args.firstName, lastName: args.lastName, dateOfBirth: args.dateOfBirth, gender: args.gender });
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
      v.literal("kyi"),
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
        v.literal("kyi"),
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
