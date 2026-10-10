import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { buildVerificationReference } from "./lib/crypto";
import { isInternalAdmin, requireClientRole } from "./lib/rbac";
import { chargeVerification } from "./lib/credits";
import {
  assertCreditsForNewVerification,
  assertMediaSize,
  creditsForType,
} from "./lib/verificationTypes";
import { actorTypeForClientRole, recordAudit, type AuditActorType } from "./auditLog";

const verificationType = v.union(v.literal("idp"), v.literal("kyb"), v.literal("aml"), v.literal("liveness"), v.literal("kyi"));
const verificationStatus = v.union(v.literal("queued"), v.literal("processing"), v.literal("completed"), v.literal("failed"));
const verificationVerdict = v.union(v.literal("pass"), v.literal("review"), v.literal("reject"));

// NOTE: the former public `review` mutation was removed (audit H7). Manual
// decisions go through reviewQueue.resolve only, which enforces the
// certainty/notes rules, audit log, queue state, charge and webhook.
const livenessMediaType = v.union(v.literal("jpeg_frames"), v.literal("mp4"));

// Typed input for an IDP check. The *Base64 fields are media: they are handed
// to the processing action through the scheduler and never stored on the
// verification row (each must fit Convex's 1 MiB value limit — see
// lib/verificationTypes.ts MAX_MEDIA_BASE64_CHARS).
export const idpInput = v.object({
  documentFrontBase64: v.string(),
  documentBackBase64: v.optional(v.string()),
  // Optional: when absent, liveness is recorded as "not_collected" and the
  // result can't auto-pass (see idp.ts).
  livenessFramesBase64: v.optional(v.string()),
  livenessMediaType: v.optional(livenessMediaType),
  idNumber: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  dateOfBirth: v.string(),
  gender: v.string(),
});
export type IdpInput = Infer<typeof idpInput>;

const DEDICATED_CREATE_PATH: Record<Exclude<Doc<"verifications">["type"], "idp">, string> = {
  kyb: "Use kyb.createKyb to submit a business verification.",
  kyi: "Use kyi.createKyi to submit an investor verification.",
  aml: "Use aml.submit to run a sanctions screening.",
  liveness: "Use liveness.submit to create a liveness invitation.",
};

const MAX_MEMBERSHIPS = 50;

// Removes media fields that older rows may still carry in `input`, so viewers
// can't read raw ID images through the read APIs.
function withoutMedia<T extends { input?: unknown }>(row: T): T {
  const input = row.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return row;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([key]) => !key.endsWith("Base64"),
  );
  if (entries.length === Object.keys(input).length) return row;
  return { ...row, input: Object.fromEntries(entries) };
}

// Client ids the signed-in member can read. Internal admins read across all
// tenants and get `null` (meaning "no tenant filter").
async function readableClientIds(ctx: QueryCtx): Promise<Id<"clients">[] | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  if (await isInternalAdmin(ctx)) return null;
  const memberships = await ctx.db
    .query("clientMembers")
    .withIndex("by_user", (q) => q.eq("userId", identity.subject))
    .take(MAX_MEMBERSHIPS);
  const ids: Id<"clients">[] = [];
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
    const clientIds = await readableClientIds(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const before = args.before;
    const type = args.type;

    let rows: Doc<"verifications">[];
    if (clientIds === null) {
      // Internal admin: newest across all tenants.
      rows = type
        ? await ctx.db
            .query("verifications")
            .withIndex("by_type_and_created_at", (q) =>
              before === undefined ? q.eq("type", type) : q.eq("type", type).lt("createdAt", before),
            )
            .order("desc")
            .take(limit + 1)
        : await ctx.db
            .query("verifications")
            .withIndex("by_created_at", (q) => (before === undefined ? q : q.lt("createdAt", before)))
            .order("desc")
            .take(limit + 1);
    } else {
      const perClient = await Promise.all(
        clientIds.map((clientId) =>
          type
            ? ctx.db
                .query("verifications")
                .withIndex("by_client_and_type_and_created_at", (q) => {
                  const scoped = q.eq("clientId", clientId).eq("type", type);
                  return before === undefined ? scoped : scoped.lt("createdAt", before);
                })
                .order("desc")
                .take(limit + 1)
            : ctx.db
                .query("verifications")
                .withIndex("by_client_and_created_at", (q) => {
                  const scoped = q.eq("clientId", clientId);
                  return before === undefined ? scoped : scoped.lt("createdAt", before);
                })
                .order("desc")
                .take(limit + 1),
        ),
      );
      rows = perClient.flat().sort((a, b) => b.createdAt - a.createdAt);
    }

    const records = rows.slice(0, limit).map(withoutMedia);
    return { records, nextCursor: rows.length > limit ? records[limit - 1].createdAt : null };
  },
});

async function canReadClient(ctx: QueryCtx, clientId: Id<"clients">): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  if (await isInternalAdmin(ctx)) return true;
  const membership = await ctx.db
    .query("clientMembers")
    .withIndex("by_client_and_user", (q) => q.eq("clientId", clientId).eq("userId", identity.subject))
    .unique();
  if (!membership?.isActive) return false;
  const client = await ctx.db.get(clientId);
  return client?.status === "active";
}

export const get = query({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return (await canReadClient(ctx, row.clientId)) ? withoutMedia(row) : null;
  },
});

function requireText(fields: Record<string, string>) {
  const missing = Object.entries(fields)
    .filter(([, value]) => !value.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new ConvexError({ code: "invalid_argument", message: `Missing required fields: ${missing.join(", ")}` });
  }
}

// Shared IDP creation path (dashboard KYC, generic create, public API).
// Checks credits, inserts the row WITHOUT media, schedules processing with
// the media, and audits the creation — all in the caller's transaction.
async function createIdpVerification(
  ctx: MutationCtx,
  params: {
    clientId: Id<"clients">;
    input: IdpInput;
    // Extra non-media fields to keep on the row (document URLs, etc.).
    storedExtras?: Record<string, unknown>;
    actor: { actorId: string; actorType: AuditActorType };
  },
) {
  const { input } = params;
  requireText({
    documentFrontBase64: input.documentFrontBase64,
    idNumber: input.idNumber,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
  });
  const hasFrames = Boolean(input.livenessFramesBase64?.trim());
  if (hasFrames !== Boolean(input.livenessMediaType)) {
    throw new ConvexError({
      code: "invalid_argument",
      message: "livenessFramesBase64 and livenessMediaType must be provided together.",
    });
  }
  assertMediaSize({
    documentFrontBase64: input.documentFrontBase64,
    documentBackBase64: input.documentBackBase64,
    livenessFramesBase64: input.livenessFramesBase64,
  });

  const creditsUsed = creditsForType("idp");
  await assertCreditsForNewVerification(ctx, params.clientId, creditsUsed);

  const now = Date.now();
  const reference = buildVerificationReference();
  const id = await ctx.db.insert("verifications", {
    clientId: params.clientId,
    type: "idp",
    status: "queued",
    creditsUsed,
    input: {
      ...params.storedExtras,
      firstName: input.firstName,
      lastName: input.lastName,
      idNumber: input.idNumber,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      livenessCollected: hasFrames,
      livenessMediaType: hasFrames ? input.livenessMediaType : undefined,
    },
    reference,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.scheduler.runAfter(0, internal.idp.processIdpVerification, {
    verificationId: id,
    clientId: params.clientId,
    livenessFramesBase64: hasFrames ? input.livenessFramesBase64 : undefined,
    livenessMediaType: hasFrames ? input.livenessMediaType : undefined,
    documentFrontBase64: input.documentFrontBase64,
    documentBackBase64: input.documentBackBase64,
    idNumber: input.idNumber,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
  });

  await recordAudit(ctx, {
    ...params.actor,
    action: "verification.created",
    targetType: "verification",
    targetId: id,
    clientId: params.clientId,
    metadata: { type: "idp", reference, livenessCollected: hasFrames },
  });

  return { id, reference };
}

// Generic creation endpoint. Only "idp" is processed here; every other type
// has a dedicated mutation that collects the data it needs (KYB directors,
// KYI documents, …), so they are rejected instead of creating a row that
// could never complete.
export const create = mutation({
  args: {
    clientId: v.id("clients"),
    type: verificationType,
    input: idpInput,
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    if (args.type !== "idp") {
      throw new ConvexError({ code: "invalid_argument", message: DEDICATED_CREATE_PATH[args.type] });
    }
    return await createIdpVerification(ctx, {
      clientId: args.clientId,
      input: args.input,
      actor: { actorId: actor.userId, actorType: actorTypeForClientRole(actor.role) },
    });
  },
});

export const createKyc = mutation({
  args: {
    clientId: v.id("clients"),
    firstName: v.string(), lastName: v.string(), idNumber: v.string(), dateOfBirth: v.string(), gender: v.string(),
    documentType: v.union(v.literal("passport"), v.literal("id_card"), v.literal("driving_license")),
    documentFrontUrl: v.string(), documentBackUrl: v.optional(v.string()), documentFrontBase64: v.string(), documentBackBase64: v.optional(v.string()),
    selfieUrl: v.string(), selfieBase64: v.string(),
    // Optional: only sent when real liveness frames/video were captured. A
    // still selfie must NOT be sent here.
    livenessFramesBase64: v.optional(v.string()), livenessMediaType: v.optional(livenessMediaType),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    requireText({ documentFrontUrl: args.documentFrontUrl, selfieUrl: args.selfieUrl, selfieBase64: args.selfieBase64 });
    // The selfie isn't processed yet (no face-match step); it is size-checked
    // but neither stored nor forwarded.
    assertMediaSize({ selfieBase64: args.selfieBase64 });
    return await createIdpVerification(ctx, {
      clientId: args.clientId,
      input: {
        documentFrontBase64: args.documentFrontBase64,
        documentBackBase64: args.documentBackBase64,
        livenessFramesBase64: args.livenessFramesBase64,
        livenessMediaType: args.livenessMediaType,
        idNumber: args.idNumber,
        firstName: args.firstName,
        lastName: args.lastName,
        dateOfBirth: args.dateOfBirth,
        gender: args.gender,
      },
      storedExtras: {
        documentType: args.documentType,
        documentFrontUrl: args.documentFrontUrl,
        documentBackUrl: args.documentBackUrl,
        selfieUrl: args.selfieUrl,
      },
      actor: { actorId: actor.userId, actorType: actorTypeForClientRole(actor.role) },
    });
  },
});

// Public API (POST /v1/verify/idp). Credit check, insert and scheduling
// happen in this one mutation, so a scheduling failure can't leave an
// orphaned "queued" row. Test-mode keys get a deterministic sandbox result:
// no provider calls, no charge.
export const _createIdpFromApi = internalMutation({
  args: {
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    input: idpInput,
  },
  handler: async (ctx, args) => {
    const actor = { actorId: args.apiKeyId, actorType: "client_api_key" as const };
    if (args.environment === "live") {
      const { id, reference } = await createIdpVerification(ctx, {
        clientId: args.clientId,
        input: args.input,
        actor,
      });
      return { id, reference, status: "queued" as const, verdict: null, sandbox: false };
    }

    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "idp",
      status: "completed",
      verdict: "pass",
      confidence: 1,
      creditsUsed: 0,
      input: { sandbox: true },
      result: {
        sandbox: true,
        note: "Test-mode API key: no providers were called and no credits were charged.",
      },
      reference,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: id });
    await recordAudit(ctx, {
      ...actor,
      action: "verification.created",
      targetType: "verification",
      targetId: id,
      clientId: args.clientId,
      metadata: { type: "idp", reference, sandbox: true },
    });
    return { id, reference, status: "completed" as const, verdict: "pass" as const, sandbox: true };
  },
});

export const _markProcessing = internalMutation({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    // Never move a finished verification back to "processing".
    if (!row || row.status === "completed" || row.status === "failed") return null;
    await ctx.db.patch(args.id, { status: "processing", updatedAt: Date.now() });
    return null;
  },
});

export const _complete = internalMutation({
  args: {
    id: v.id("verifications"),
    verdict: verificationVerdict,
    confidence: v.number(),
    result: v.any(),
    // When set, charges the row's creditsUsed in this same transaction
    // (idempotent per verification).
    chargeReason: v.optional(v.string()),
    // When true, schedules the client webhook in this same transaction.
    notifyWebhook: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "completed",
      verdict: args.verdict,
      confidence: args.confidence,
      result: args.result,
      updatedAt: now,
      completedAt: now,
    });
    if (args.chargeReason !== undefined) {
      await chargeVerification(ctx, {
        clientId: row.clientId,
        verificationId: args.id,
        amount: row.creditsUsed,
        reason: args.chargeReason,
      });
    }
    if (args.notifyWebhook) {
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: args.id });
    }
    return null;
  },
});

// Marks a verification failed. A verification that already completed is
// left untouched (returns false), so a late error can't overwrite a verdict
// or send a FAILED webhook after a PASS/REJECT one.
export const _fail = internalMutation({
  args: {
    id: v.id("verifications"),
    reason: v.string(),
    notifyWebhook: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status === "completed") return false;
    await ctx.db.patch(args.id, {
      status: "failed",
      failureReason: args.reason,
      updatedAt: Date.now(),
    });
    if (args.notifyWebhook) {
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: args.id });
    }
    return true;
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
    notifyWebhook: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "completed",
      verdict: "review",
      result: args.result,
      updatedAt: now,
      completedAt: now,
    });
    await ctx.db.insert("reviewQueue", {
      verificationId: args.id,
      clientId: args.clientId,
      triggerType: args.triggerType,
      triggerReason: args.triggerReason,
      priority: args.priority,
      status: "pending",
      createdAt: now,
    });
    if (args.notifyWebhook) {
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: args.id });
    }
    return null;
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

// Cap on rows scanned when a status filter has to be applied after the index.
const STATUS_FILTER_SCAN_LIMIT = 1000;

export const _listForClient = internalQuery({
  args: {
    clientId: v.id("clients"),
    status: v.optional(verificationStatus),
    type: v.optional(verificationType),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const { before, type, status } = args;
    const base = type
      ? ctx.db
          .query("verifications")
          .withIndex("by_client_and_type_and_created_at", (q) => {
            const scoped = q.eq("clientId", args.clientId).eq("type", type);
            return before === undefined ? scoped : scoped.lt("createdAt", before);
          })
      : ctx.db
          .query("verifications")
          .withIndex("by_client_and_created_at", (q) => {
            const scoped = q.eq("clientId", args.clientId);
            return before === undefined ? scoped : scoped.lt("createdAt", before);
          });
    const ordered = base.order("desc");
    // Status has no createdAt-ordered index of its own: scan a bounded window
    // and filter. A partial page still returns a cursor so callers continue.
    const scanned = status ? await ordered.take(STATUS_FILTER_SCAN_LIMIT) : await ordered.take(limit + 1);
    const matching = status ? scanned.filter((row) => row.status === status) : scanned;
    const records = matching.slice(0, limit);
    const exhaustedScan = status !== undefined && scanned.length === STATUS_FILTER_SCAN_LIMIT;
    const lastScanned = scanned[scanned.length - 1];

    let nextCursor: number | null = null;
    if (matching.length > records.length) {
      nextCursor = records[records.length - 1]?.createdAt ?? null;
    } else if (exhaustedScan && lastScanned) {
      nextCursor = lastScanned.createdAt;
    }
    return { records, nextCursor };
  },
});

export const _getById = internalQuery({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
