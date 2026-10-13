import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { buildVerificationReference } from "./lib/crypto";
import { assertCreditsForNewVerification, assertMediaSize, creditsForType } from "./lib/verificationTypes";
import { chargeVerification } from "./lib/credits";
import { actorTypeForClientRole, recordAudit, type AuditActorType } from "./auditLog";
import { DEFAULT_POA_MAX_AGE_DAYS } from "./lib/documentChecks";
import { withoutMedia } from "./verifications";

// IDP — Intelligent Document Processing. Verifies an identity document
// (passport, national ID, driver's licence, residence permit) or a proof of
// address. Creation is here; the pipeline (Claude vision, AWS Textract OCR,
// file forensics and rule checks) runs in documentsNode.processDocument, and
// the result is stored by _complete.

const internalApi: any = internal;

export const MAX_TEXT_LENGTH = 300;
export const MAX_POA_AGE_DAYS = 365;

export const documentKindValidator = v.union(v.literal("identity"), v.literal("proof_of_address"));

export const documentInputValidator = {
  documentKind: documentKindValidator,
  // Base64 image (JPEG, PNG, WebP) or PDF, without a data: prefix.
  documentFrontBase64: v.string(),
  documentBackBase64: v.optional(v.string()),
  // Optional details to match the document against.
  expectedName: v.optional(v.string()),
  expectedAddress: v.optional(v.string()),
  expectedDateOfBirth: v.optional(v.string()),
  // Proof of address only: the oldest acceptable issue date, in days.
  maxDocumentAgeDays: v.optional(v.number()),
  // The client's own reference for the document or customer.
  externalRef: v.optional(v.string()),
  // Set by the portal when it had to shrink an image to fit the upload limit:
  // re-encoding removes the file metadata that forensics reads.
  resized: v.optional(v.boolean()),
};

export type DocumentInput = {
  documentKind: "identity" | "proof_of_address";
  documentFrontBase64: string;
  documentBackBase64?: string;
  expectedName?: string;
  expectedAddress?: string;
  expectedDateOfBirth?: string;
  maxDocumentAgeDays?: number;
  externalRef?: string;
  resized?: boolean;
};

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function text(value: string | undefined, label: string) {
  const trimmed = value?.trim() || undefined;
  if (trimmed && trimmed.length > MAX_TEXT_LENGTH) invalid(`${label} is too long.`);
  return trimmed;
}

function stripDataUrl(value: string) {
  return value.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
}

export function normalizeDocumentInput(args: DocumentInput) {
  const documentFrontBase64 = stripDataUrl(args.documentFrontBase64);
  if (!documentFrontBase64) invalid("documentFrontBase64 is required.");
  const documentBackBase64 = args.documentBackBase64 ? stripDataUrl(args.documentBackBase64) : undefined;
  if (args.documentKind === "proof_of_address" && documentBackBase64) invalid("Proof of address takes one document (documentFrontBase64).");
  assertMediaSize({ documentFrontBase64, documentBackBase64 });
  const expectedDateOfBirth = text(args.expectedDateOfBirth, "Expected date of birth");
  if (expectedDateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDateOfBirth)) invalid("Expected date of birth must be YYYY-MM-DD.");
  const maxDocumentAgeDays = args.maxDocumentAgeDays;
  if (maxDocumentAgeDays !== undefined) {
    if (args.documentKind !== "proof_of_address") invalid("maxDocumentAgeDays applies to proof of address only.");
    if (!Number.isInteger(maxDocumentAgeDays) || maxDocumentAgeDays < 1 || maxDocumentAgeDays > MAX_POA_AGE_DAYS) {
      invalid(`maxDocumentAgeDays must be a whole number from 1 to ${MAX_POA_AGE_DAYS}.`);
    }
  }
  return {
    documentKind: args.documentKind,
    documentFrontBase64,
    documentBackBase64,
    expected: {
      name: text(args.expectedName, "Expected name"),
      address: text(args.expectedAddress, "Expected address"),
      dateOfBirth: expectedDateOfBirth,
    },
    maxDocumentAgeDays: args.documentKind === "proof_of_address" ? maxDocumentAgeDays ?? DEFAULT_POA_MAX_AGE_DAYS : undefined,
    externalRef: text(args.externalRef, "External reference"),
    resized: args.resized === true,
  };
}

async function requireActiveClient(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get(clientId);
  if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
}

async function createDocumentVerification(
  ctx: MutationCtx,
  args: DocumentInput & { clientId: Id<"clients">; actor: { actorId: string; actorType: AuditActorType } },
) {
  const input = normalizeDocumentInput(args);
  await requireActiveClient(ctx, args.clientId);
  const creditsUsed = creditsForType("document");
  await assertCreditsForNewVerification(ctx, args.clientId, creditsUsed);
  const now = Date.now();
  const reference = buildVerificationReference();
  const verificationId = await ctx.db.insert("verifications", {
    clientId: args.clientId,
    type: "document",
    status: "queued",
    creditsUsed,
    // Media is passed to the pipeline only; it is never stored.
    input: {
      documentKind: input.documentKind,
      pages: input.documentBackBase64 ? 2 : 1,
      expectedName: input.expected.name ?? null,
      expectedAddress: input.expected.address ?? null,
      expectedDateOfBirth: input.expected.dateOfBirth ?? null,
      maxDocumentAgeDays: input.maxDocumentAgeDays ?? null,
      externalRef: input.externalRef ?? null,
      resized: input.resized,
    },
    reference,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internalApi.documentsNode.processDocument, {
    verificationId,
    clientId: args.clientId,
    documentKind: input.documentKind,
    documentFrontBase64: input.documentFrontBase64,
    documentBackBase64: input.documentBackBase64,
    expectedName: input.expected.name,
    expectedAddress: input.expected.address,
    expectedDateOfBirth: input.expected.dateOfBirth,
    maxDocumentAgeDays: input.maxDocumentAgeDays,
    resized: input.resized,
  });
  await recordAudit(ctx, {
    ...args.actor,
    action: "verification.created",
    targetType: "verification",
    targetId: verificationId,
    clientId: args.clientId,
    metadata: { type: "document", documentKind: input.documentKind, reference },
  });
  return { verificationId, reference };
}

export const submit = mutation({
  args: { clientId: v.id("clients"), ...documentInputValidator },
  handler: async (ctx, args) => {
    const { userId, role } = await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const { clientId, ...input } = args;
    const { verificationId } = await createDocumentVerification(ctx, {
      ...input,
      clientId,
      actor: { actorId: userId, actorType: actorTypeForClientRole(role) },
    });
    return { verificationId };
  },
});

// POST /v1/verify/document. Test-mode keys get a sandbox "pass" without
// processing or charges, like the other verification types.
export const _createFromApi = internalMutation({
  args: {
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    ...documentInputValidator,
  },
  handler: async (ctx, args) => {
    const actor = { actorId: args.apiKeyId, actorType: "client_api_key" as const };
    const { apiKeyId: _apiKeyId, environment, clientId, ...input } = args;
    if (environment === "live") {
      const { reference } = await createDocumentVerification(ctx, { ...input, clientId, actor });
      return { reference, status: "queued" as const, verdict: null, sandbox: false };
    }
    normalizeDocumentInput(input);
    await requireActiveClient(ctx, clientId);
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", {
      clientId,
      type: "document",
      status: "completed",
      verdict: "pass",
      confidence: 1,
      creditsUsed: 0,
      input: { sandbox: true, documentKind: input.documentKind },
      result: { sandbox: true, reason: "Test-mode API key: the document was not processed and no credits were charged.", flags: [] },
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
      clientId,
      metadata: { type: "document", documentKind: input.documentKind, reference, sandbox: true },
    });
    return { reference, status: "completed" as const, verdict: "pass" as const, sandbox: true };
  },
});

// Stores the pipeline's result (documentsNode.processDocument): verdict and
// result, a review item for anything but a pass, the charge, audit and
// webhook. A complete reading is charged; a pipeline outage is not.
export const _complete = internalMutation({
  args: {
    verificationId: v.id("verifications"),
    verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    reason: v.string(),
    riskScore: v.number(),
    chargeCredits: v.boolean(),
    // The full result: extracted fields, checks, flags, OCR and AI summaries.
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification.status === "completed") return;
    const now = Date.now();
    await ctx.db.patch(args.verificationId, {
      status: "completed",
      verdict: args.verdict,
      confidence: Math.max(0, Math.min(1, 1 - args.riskScore / 100)),
      result: { ...args.result, reason: args.reason, riskScore: args.riskScore },
      updatedAt: now,
      completedAt: now,
    });
    if (args.verdict !== "pass") {
      await ctx.db.insert("reviewQueue", {
        verificationId: args.verificationId,
        clientId: verification.clientId,
        triggerType: "auto_escalation",
        triggerReason: args.reason.slice(0, 1000),
        priority: args.verdict === "reject" ? "high" : "normal",
        status: "pending",
        createdAt: now,
      });
    }
    if (args.chargeCredits) {
      await chargeVerification(ctx, {
        clientId: verification.clientId,
        verificationId: args.verificationId,
        amount: verification.creditsUsed,
        reason: `IDP document verification: ${args.verdict}`,
      });
    }
    await recordAudit(ctx, {
      actorId: "system",
      actorType: "system",
      action: "document.verified",
      targetType: "verification",
      targetId: args.verificationId,
      clientId: verification.clientId,
      metadata: {
        verdict: args.verdict,
        riskScore: args.riskScore,
        documentKind: (verification.input as { documentKind?: string } | null)?.documentKind ?? null,
        flags: ((args.result as { flags?: Array<{ code: string }> } | null)?.flags ?? []).map((flag) => flag.code).slice(0, 30),
      },
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: args.verificationId });
  },
});

// ── Portal ─────────────────────────────────────────────────────────────────

const READ_ROLES = ["client_admin", "compliance_analyst", "developer", "viewer"] as const;

export const listForClient = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, [...READ_ROLES]);
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_type_and_created_at", (q) => q.eq("clientId", args.clientId).eq("type", "document"))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 50, 1), 100));
    return rows.map(withoutMedia);
  },
});

// Everything the IDP report page shows for one document verification.
export const reportForClient = query({
  // A plain string, so a mistyped link shows "not found" instead of an error.
  args: { verificationId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("verifications", args.verificationId);
    const verification = id ? await ctx.db.get(id) : null;
    if (!verification || verification.type !== "document") return null;
    try {
      await requireClientRole(ctx, verification.clientId, [...READ_ROLES]);
    } catch {
      return null;
    }
    const client = await ctx.db.get(verification.clientId);
    const review = await ctx.db
      .query("reviewQueue")
      .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
      .order("desc")
      .first();
    return {
      verification: withoutMedia(verification),
      clientName: client?.name ?? null,
      review: review
        ? {
            status: review.status,
            priority: review.priority,
            triggerReason: review.triggerReason,
            createdAt: review.createdAt,
            resolutionAction: review.resolutionAction ?? null,
            resolutionNotes: review.resolutionNotes ?? null,
            resolvedAt: review.resolvedAt ?? null,
            resolvedByName: review.resolvedByName ?? null,
          }
        : null,
    };
  },
});
