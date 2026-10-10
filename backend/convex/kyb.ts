import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { buildVerificationReference } from "./lib/crypto";
import { requireClientRole } from "./lib/rbac";
import { assertCreditsForNewVerification, creditsForType } from "./lib/verificationTypes";
import { actorTypeForClientRole, recordAudit } from "./auditLog";

const MAX_DIRECTORS = 50;

const directorInput = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  position: v.string(),
  shareholding: v.optional(v.string()),
  dateOfBirth: v.string(),
  idNumber: v.string(),
});

export const createKyb = mutation({
  args: {
    clientId: v.id("clients"),
    businessName: v.string(),
    registrationNumber: v.string(),
    incorporationCountry: v.string(),
    businessType: v.optional(v.string()),
    registrationDocUrl: v.string(),
    proofOfAddressUrl: v.string(),
    directors: v.array(directorInput),
  },
  handler: async (ctx, args) => {
    // Also rejects inactive clients (write role set).
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    if (!args.businessName.trim() || !args.registrationNumber.trim() || !args.registrationDocUrl.trim()) {
      throw new ConvexError({ code: "invalid_argument", message: "Business name, registration number, and registration document are required." });
    }
    if (args.directors.length === 0) {
      throw new ConvexError({ code: "invalid_argument", message: "At least one director/UBO is required." });
    }
    if (args.directors.length > MAX_DIRECTORS) {
      throw new ConvexError({ code: "invalid_argument", message: `At most ${MAX_DIRECTORS} directors/UBOs can be submitted.` });
    }

    const creditsUsed = creditsForType("kyb");
    await assertCreditsForNewVerification(ctx, args.clientId, creditsUsed);

    const now = Date.now();
    const reference = buildVerificationReference();
    const verificationId = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "kyb",
      status: "queued",
      creditsUsed,
      input: {
        businessName: args.businessName,
        registrationNumber: args.registrationNumber,
        incorporationCountry: args.incorporationCountry,
        businessType: args.businessType,
        registrationDocUrl: args.registrationDocUrl,
        proofOfAddressUrl: args.proofOfAddressUrl,
        directorCount: args.directors.length,
      },
      reference,
      createdAt: now,
      updatedAt: now,
    });

    for (const director of args.directors) {
      await ctx.db.insert("kybDirectors", {
        kybVerificationId: verificationId,
        clientId: args.clientId,
        firstName: director.firstName,
        lastName: director.lastName,
        email: director.email,
        position: director.position,
        shareholding: director.shareholding,
        dateOfBirth: director.dateOfBirth,
        idNumber: director.idNumber,
        status: "pending",
        createdAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.kyb.processKybVerification, { verificationId, clientId: args.clientId });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "verification.created",
      targetType: "verification",
      targetId: verificationId,
      clientId: args.clientId,
      metadata: { type: "kyb", reference, directorCount: args.directors.length },
    });
    return { id: verificationId, reference };
  },
});

// Every terminal state notifies the client webhook (like idp.ts). KYB is
// charged when the review item is resolved (reviewQueue.resolve).
export const processKybVerification = internalAction({
  args: { verificationId: v.id("verifications"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.verifications._markProcessing, { id: args.verificationId });

    try {
      const directors: Doc<"kybDirectors">[] = await ctx.runQuery(internal.kyb._getDirectors, {
        kybVerificationId: args.verificationId,
      });
      if (directors.length === 0) {
        await ctx.runMutation(internal.verifications._fail, {
          id: args.verificationId,
          reason: "No directors/UBOs found for this KYB submission.",
          notifyWebhook: true,
        });
        return;
      }

      // TODO: dispatch each director through internal.idp.processIdpVerification
      // (linking back via kybDirectors.idpVerificationId) once you want
      // per-director identity checks to run automatically. For now every
      // KYB submission routes to manual review — a business shouldn't
      // auto-pass without a human checking the registry documents.
      await ctx.runMutation(internal.verifications._completeWithReview, {
        id: args.verificationId,
        clientId: args.clientId,
        result: { source: "kyb", directorCount: directors.length },
        triggerType: "internal_flag",
        triggerReason: "New business verification — pending manual document + UBO review.",
        priority: "normal",
        notifyWebhook: true,
      });
    } catch (err) {
      console.error("[kyb] processing failed", args.verificationId, err);
      await ctx.runMutation(internal.verifications._fail, {
        id: args.verificationId,
        reason: "Business verification processing failed. Please retry or contact support.",
        notifyWebhook: true,
      });
    }
  },
});

export const _getDirectors = internalQuery({
  args: { kybVerificationId: v.id("verifications") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("kybDirectors")
      .withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", args.kybVerificationId))
      .take(MAX_DIRECTORS),
});

export const getDirectors = query({
  args: { kybVerificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.kybVerificationId);
    if (!verification) return [];
    await requireClientRole(ctx, verification.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    return await ctx.db
      .query("kybDirectors")
      .withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", args.kybVerificationId))
      .take(MAX_DIRECTORS);
  },
});
