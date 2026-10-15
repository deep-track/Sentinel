import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { buildVerificationReference, sha256Hex } from "./lib/crypto";
import { readBrsResponse } from "./lib/kenyaBrs";
import { requireClientRole } from "./lib/rbac";
import { assertCreditsForNewVerification, creditsForVerification } from "./lib/verificationTypes";
import { chargeVerification } from "./lib/credits";
import { isPartialIsoDate } from "./lib/amlCategories";
import { subjectKeyFor } from "./lib/amlClearedMatches";
import type { ScreeningRules } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { queueReview } from "./clientReviews";
import { screenSubjects, type ScreeningOutcome } from "./aml";

const internalApi: any = internal;

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
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer"]);
    if (!args.businessName.trim() || !args.registrationNumber.trim() || !args.registrationDocUrl.trim()) {
      throw new ConvexError({ code: "invalid_argument", message: "Business name, registration number, and registration document are required." });
    }
    if (args.directors.length === 0) {
      throw new ConvexError({ code: "invalid_argument", message: "At least one director/UBO is required." });
    }
    if (args.directors.length > MAX_DIRECTORS) {
      throw new ConvexError({ code: "invalid_argument", message: `At most ${MAX_DIRECTORS} directors/UBOs can be submitted.` });
    }

    const creditsUsed = await creditsForVerification(ctx, args.clientId, "kyb");
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

// Starts the automated checks (kybNode.processKyb): the registration
// certificate, proof of address, and AML screening of the business and each
// director / owner. Every terminal state notifies the client webhook.
export const processKybVerification = internalAction({
  args: { verificationId: v.id("verifications"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.verifications._markProcessing, { id: args.verificationId });
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
    await ctx.scheduler.runAfter(0, internalApi.kybNode.processKyb, args);
  },
});

// When the automated checks can't run at all: a person reviews it, as before.
export const _manualReview = internalMutation({
  args: { verificationId: v.id("verifications"), clientId: v.id("clients"), reason: v.string(), result: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification.status === "completed" || verification.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(args.verificationId, {
      status: "completed",
      verdict: "review",
      result: { source: "kyb", automated: false, reason: args.reason, ...(args.result ?? {}) },
      updatedAt: now,
      completedAt: now,
    });
    await queueReview(ctx, {
      verificationId: args.verificationId,
      clientId: args.clientId,
      triggerType: "internal_flag",
      triggerReason: args.reason,
      priority: "normal",
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: args.verificationId });
  },
});

export const _forProcessing = internalQuery({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) return null;
    const directors = await ctx.db
      .query("kybDirectors")
      .withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", args.verificationId))
      .take(MAX_DIRECTORS);
    return { verification, directors };
  },
});

const partyValidator = v.object({
  subjectName: v.string(),
  entityType: v.union(v.literal("individual"), v.literal("entity")),
  country: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  idNumber: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  jurisdiction: v.optional(v.string()),
});

// AML screening of the business and its directors / owners, under the
// client's screening rules (match threshold, adverse media, cleared hits).
export const _screenParties = internalAction({
  args: { clientId: v.id("clients"), subjects: v.array(partyValidator) },
  handler: async (ctx, args): Promise<ScreeningOutcome[]> => {
    const subjects = args.subjects.map((subject) => ({
      ...subject,
      ...(subject.dateOfBirth && !isPartialIsoDate(subject.dateOfBirth) ? { dateOfBirth: undefined } : {}),
    }));
    const rules: ScreeningRules[] = await ctx.runQuery(internalApi.aml._screeningRules, {
      clientIds: subjects.map(() => args.clientId),
      subjectKeys: subjects.map((subject) => subjectKeyFor(subject)),
    });
    return await screenSubjects(ctx, subjects, rules);
  },
});

const hitValidator = v.object({
  source: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"), v.literal("EU_FSF"), v.literal("UK_SANCTIONS"), v.literal("OPENSANCTIONS"), v.literal("ADVERSE_MEDIA")),
  sourceRecordId: v.string(),
  entityName: v.string(),
  program: v.string(),
  matchScore: v.number(),
  matchMethod: v.union(v.literal("exact"), v.literal("normalized"), v.literal("alias"), v.literal("fuzzy"), v.literal("provider_score"), v.literal("ai_classification")),
  riskLevel: v.union(v.literal("critical"), v.literal("high")),
  categories: v.optional(v.array(v.string())),
  pepClass: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
  matchedCountry: v.optional(v.string()),
});

// Stores the automated result: verdict, details, hits on each party (so the
// review case is categorised as a sanctions / PEP case), director statuses,
// a review case unless it passed, the charge, audit and webhook.
export const _completeAutomated = internalMutation({
  args: {
    verificationId: v.id("verifications"),
    verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    reason: v.string(),
    complete: v.boolean(),
    result: v.any(),
    parties: v.array(
      v.object({
        name: v.string(),
        directorId: v.optional(v.id("kybDirectors")),
        verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
        hits: v.array(hitValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification.status === "completed" || verification.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(verification._id, {
      status: "completed",
      verdict: args.verdict,
      result: { source: "kyb", automated: true, reason: args.reason, ...args.result },
      updatedAt: now,
      completedAt: now,
    });
    for (const party of args.parties) {
      for (const hit of party.hits.slice(0, 25)) {
        await ctx.db.insert("flaggedEntities", {
          entityName: hit.entityName,
          source: hit.source,
          program: `${party.name}: ${hit.program}`.slice(0, 500),
          matchScore: hit.matchScore,
          clientId: verification.clientId,
          verificationId: verification._id,
          ...(hit.source === "OPENSANCTIONS" || hit.source === "ADVERSE_MEDIA" ? { externalId: hit.sourceRecordId } : {}),
          ...(hit.categories ? { categories: hit.categories as Array<"sanctions" | "pep" | "special_interest" | "fitness_probity" | "adverse_media" | "insolvency"> } : {}),
          ...(hit.pepClass ? { pepClass: hit.pepClass } : {}),
          matchMethod: hit.matchMethod,
          riskLevel: hit.riskLevel,
          matchedCountry: hit.matchedCountry,
          createdAt: now,
        });
      }
      if (party.directorId) {
        await ctx.db.patch(party.directorId, { status: party.verdict === "pass" ? "verified" : party.verdict === "reject" ? "failed" : "pending" });
      }
    }
    if (args.verdict !== "pass") {
      await queueReview(ctx, {
        verificationId: verification._id,
        clientId: verification.clientId,
        triggerType: "auto_escalation",
        triggerReason: args.reason.slice(0, 1000),
        priority: args.verdict === "reject" ? "high" : "normal",
      });
    }
    // Charged once the checks ran; an outage on our side isn't billed here
    // (the review resolution charges it then).
    if (args.complete) {
      await chargeVerification(ctx, {
        clientId: verification.clientId,
        verificationId: verification._id,
        amount: verification.creditsUsed,
        reason: `KYB business verification: ${args.verdict}`,
      });
    }
    await recordAudit(ctx, {
      actorId: "system",
      actorType: "system",
      action: "kyb.checked",
      targetType: "verification",
      targetId: verification._id,
      clientId: verification.clientId,
      metadata: { verdict: args.verdict, complete: args.complete, parties: args.parties.length, hits: args.parties.reduce((sum, party) => sum + party.hits.length, 0) },
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: verification._id });
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
    await requireClientRole(ctx, verification.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    return await ctx.db
      .query("kybDirectors")
      .withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", args.kybVerificationId))
      .take(MAX_DIRECTORS);
  },
});

// ── Kenya BRS registry lookups (MetaMap) ────────────────────────────────────

export const _startRegistryLookup = internalMutation({
  args: { verificationId: v.id("verifications"), tokenHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("kybRegistryLookups", { verificationId: args.verificationId, tokenHash: args.tokenHash, status: "pending", requestedAt: Date.now() });
  },
});

export const _registryLookup = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const lookup = await ctx.db
      .query("kybRegistryLookups")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    return lookup ? { status: lookup.status, response: lookup.response ?? null } : null;
  },
});

// MetaMap's callback. An answer that arrives after the checks finished is
// added to the result for the reviewer.
export const receiveRegistryCallback = internalMutation({
  args: { token: v.string(), body: v.any() },
  handler: async (ctx, args): Promise<{ accepted: boolean }> => {
    const tokenHash = await sha256Hex(args.token);
    const lookup = await ctx.db
      .query("kybRegistryLookups")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!lookup) return { accepted: false };
    if (lookup.status === "received") return { accepted: true };
    const now = Date.now();
    await ctx.db.patch(lookup._id, { status: "received", response: args.body, receivedAt: now });
    const verification = await ctx.db.get(lookup.verificationId);
    const result = verification?.result as Record<string, unknown> | undefined;
    if (verification && verification.status === "completed" && result?.registry) {
      const read = readBrsResponse(args.body);
      await ctx.db.patch(verification._id, {
        result: { ...result, registry: { ...(result.registry as Record<string, unknown>), lateResponse: { receivedAt: now, ...read } } },
        updatedAt: now,
      });
    }
    return { accepted: true };
  },
});
