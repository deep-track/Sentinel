import { ConvexError, v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { REVIEW_WORK_ROLES } from "./lib/clientSettings";
import { recordAudit, actorTypeForClientRole } from "./auditLog";
import { fetchEntityNested } from "./lib/openSanctions";
import { AI_REVIEW_MODEL, assessHits, compareIdNumbers, listedDetails, MAX_HITS_REVIEWED, type HitEvidence, type ReviewSubject } from "./lib/aiHitReview";

// AI hit review for AML cases: when a case opens (if the client's setting
// is on) or on request, Claude assesses every hit and recommends clearing,
// confirming or escalating (lib/aiHitReview.ts). The result is stored on
// the case for the reviewer; nothing is decided automatically.

const internalApi: any = internal;
const MAX_PROFILE_LOOKUPS = 6;
const RERUN_AFTER_MS = 60 * 1000;

type StoredMatch = {
  source: string;
  sourceRecordId: string;
  entityName: string;
  program?: string;
  matchScore?: number;
  matchMethod?: string;
  matchedCountry?: string;
  countryMatch?: string;
  birthDateMatch?: string;
  categories?: string[];
  pepClass?: number;
  topics?: string[];
  pepPositions?: Array<{ title: string; country: string | null; startDate: string | null; endDate: string | null; current: boolean }>;
  media?: { title: string; domain: string | null; publishedAt: string | null; aboutSubject: string; summary: string };
};

export function canReview(verification: Pick<Doc<"verifications">, "type" | "result"> | null): boolean {
  const matches = (verification?.result as { matches?: unknown[] } | null)?.matches;
  return verification?.type === "aml" && Array.isArray(matches) && matches.length > 0;
}

// Called by clientReviews.queueReview when a case opens.
export async function scheduleHitReview(ctx: { db: any; scheduler: any }, reviewId: Id<"reviewQueue">, verification: Doc<"verifications"> | null, enabled: boolean) {
  if (!enabled || !canReview(verification) || !process.env.ANTHROPIC_API_KEY) return false;
  await ctx.db.patch(reviewId, { aiAssessment: { status: "pending", requestedAt: Date.now() } });
  await ctx.scheduler.runAfter(0, internalApi.aiHitReview.assess, { reviewId });
  return true;
}

export const request = mutation({
  args: { reviewId: v.id("reviewQueue") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reviewId);
    if (!row) throw new ConvexError({ code: "not_found", message: "Case not found." });
    const actor = await requireClientRole(ctx, row.clientId, REVIEW_WORK_ROLES);
    const verification = await ctx.db.get(row.verificationId);
    if (!canReview(verification)) throw new ConvexError({ code: "invalid_argument", message: "AI review is for AML cases with hits." });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "not_configured", message: "AI review isn't configured." });
    const previous = row.aiAssessment as { status?: string; requestedAt?: number } | undefined;
    if (previous?.status === "pending" && Date.now() - (previous.requestedAt ?? 0) < RERUN_AFTER_MS) return null;
    await ctx.db.patch(row._id, { aiAssessment: { status: "pending", requestedAt: Date.now(), requestedBy: actor.userId } });
    await recordAudit(ctx, { actorId: actor.userId, actorType: actorTypeForClientRole(actor.role), action: "review.ai_requested", targetType: "verification", targetId: row.verificationId, clientId: row.clientId, metadata: { reviewId: row._id } });
    await ctx.scheduler.runAfter(0, internalApi.aiHitReview.assess, { reviewId: row._id });
    return null;
  },
});

export const _case = internalQuery({
  args: { reviewId: v.id("reviewQueue") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reviewId);
    if (!row) return null;
    const verification = await ctx.db.get(row.verificationId);
    if (!verification) return null;
    return { input: (verification.input ?? {}) as Record<string, unknown>, matches: ((verification.result as { matches?: StoredMatch[] } | null)?.matches ?? []) as StoredMatch[] };
  },
});

export const _store = internalMutation({
  args: { reviewId: v.id("reviewQueue"), assessment: v.any() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reviewId);
    if (!row) return;
    await ctx.db.patch(row._id, { aiAssessment: args.assessment });
    if (args.assessment?.status === "done") {
      await recordAudit(ctx, {
        actorId: "system",
        actorType: "system",
        action: "review.ai_assessed",
        targetType: "verification",
        targetId: row.verificationId,
        clientId: row.clientId,
        metadata: { reviewId: row._id, recommendation: args.assessment.recommendation, confidence: args.assessment.confidence, model: args.assessment.model },
      });
    }
  },
});

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export const assess = internalAction({
  args: { reviewId: v.id("reviewQueue") },
  handler: async (ctx, args) => {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const data: { input: Record<string, unknown>; matches: StoredMatch[] } | null = await ctx.runQuery(internalApi.aiHitReview._case, args);
    if (!data || !apiKey) return;
    const { input, matches } = data;
    const subject: ReviewSubject = {
      name: text(input.subjectName) ?? "Unknown",
      entityType: input.entityType === "entity" ? "entity" : "individual",
      dateOfBirth: text(input.dateOfBirth),
      nationality: text(input.nationality),
      country: text(input.country),
      idNumber: text(input.idNumber),
      registrationNumber: text(input.registrationNumber),
      aliases: Array.isArray(input.aliases) ? (input.aliases as unknown[]).filter((alias): alias is string => typeof alias === "string").slice(0, 5) : [],
    };
    const openSanctionsKey = process.env.OPENSANCTIONS_API_KEY?.trim();
    let lookups = 0;
    const hits: HitEvidence[] = [];
    for (const match of matches.slice(0, MAX_HITS_REVIEWED)) {
      let listed: HitEvidence["listed"] = null;
      if (match.source === "OPENSANCTIONS" && openSanctionsKey && lookups < MAX_PROFILE_LOOKUPS) {
        lookups += 1;
        try {
          listed = listedDetails(await fetchEntityNested(match.sourceRecordId, { apiKey: openSanctionsKey }));
        } catch {
          listed = null;
        }
      }
      hits.push({
        source: match.source,
        sourceRecordId: match.sourceRecordId,
        name: match.entityName,
        categories: match.categories?.length ? match.categories : match.source === "ADVERSE_MEDIA" ? ["adverse_media"] : ["sanctions"],
        pepClass: match.pepClass ?? null,
        program: match.program ?? null,
        matchScore: match.matchScore ?? null,
        matchMethod: match.matchMethod ?? null,
        matchedCountry: match.matchedCountry ?? null,
        countryCheck: match.countryMatch && match.countryMatch !== "unknown" ? (match.countryMatch === "match" ? "same country as the customer" : "different country from the customer") : null,
        birthDateCheck: match.birthDateMatch && match.birthDateMatch !== "unknown" ? (match.birthDateMatch === "match" ? "matches the customer" : "differs from the customer") : null,
        idNumberCheck: listed ? compareIdNumbers(subject.idNumber, listed.idNumbers) : null,
        topics: match.topics ?? [],
        positions: match.pepPositions?.map((position) => `${position.title}${position.country ? ` (${position.country.toUpperCase()})` : ""}, ${position.startDate ?? "?"} to ${position.current ? "present" : position.endDate ?? "ended"}`) ?? [],
        media: match.media ? { title: match.media.title ?? match.entityName, domain: match.media.domain, publishedAt: match.media.publishedAt, aboutSubject: match.media.aboutSubject, summary: match.media.summary } : null,
        listed: listed ? { ...listed, idNumbers: [] } : null,
      });
    }
    try {
      const assessment = await assessHits(new Anthropic({ apiKey }), subject, hits);
      await ctx.runMutation(internalApi.aiHitReview._store, { reviewId: args.reviewId, assessment: { status: "done", completedAt: Date.now(), model: AI_REVIEW_MODEL, profilesChecked: lookups, ...assessment } });
    } catch (error) {
      console.error("[ai hit review] failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
      await ctx.runMutation(internalApi.aiHitReview._store, { reviewId: args.reviewId, assessment: { status: "failed", completedAt: Date.now(), error: "The AI review couldn't be completed. Try again, or review the hits yourself." } });
    }
  },
});
