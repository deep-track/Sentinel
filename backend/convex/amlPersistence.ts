import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chargeVerification } from "./lib/credits";
import { MAX_LIST_AGE_MS, SOURCE_KEYS, type SourceKey } from "./lib/amlMatching";
import { summarizeCategories } from "./lib/amlCategories";
import { setBaselineFromEnrolment } from "./lib/amlMonitoringStore";
import type { MutationCtx } from "./_generated/server";
import type { Infer } from "convex/values";

const sourceKeyValidator = v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"));
const openSanctionsStatusValidator = v.union(
  v.literal("screened"),
  v.literal("unavailable"),
  v.literal("not_configured"),
);

// Coverage check for screening. Returns the newest active version of every
// source, and lists which sources are missing (no active version) or stale
// (older than the max age for the source's cadence). Screening is only allowed
// to auto-pass when both lists are empty. `now` is passed in because queries
// must not read the wall clock.
export async function loadWatchlistCoverage(ctx: QueryCtx, now: number) {
  const versions: Array<{
    _id: Id<"watchlistVersions">;
    sourceKey: SourceKey;
    fetchedAt: number;
    recordCount: number;
    stale: boolean;
  }> = [];
  const missing: SourceKey[] = [];
  const stale: SourceKey[] = [];
  // The last ingestion error per source, for the Ops alerts.
  const lastErrors: Partial<Record<SourceKey, string>> = {};
  for (const sourceKey of SOURCE_KEYS) {
    const source = await ctx.db
      .query("watchlistSources")
      .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
      .first();
    if (source?.lastError) lastErrors[sourceKey] = source.lastError;
    const active = await ctx.db
      .query("watchlistVersions")
      .withIndex("by_source_and_status", (q) => q.eq("sourceKey", sourceKey).eq("status", "active"))
      .order("desc")
      .first();
    if (!active || active.recordCount <= 0) {
      missing.push(sourceKey);
      continue;
    }
    const maxAge = MAX_LIST_AGE_MS[source?.cadence ?? "daily"];
    const isStale = now - active.fetchedAt > maxAge;
    if (isStale) stale.push(sourceKey);
    versions.push({
      _id: active._id,
      sourceKey,
      fetchedAt: active.fetchedAt,
      recordCount: active.recordCount,
      stale: isStale,
    });
  }
  return { versions, missing, stale, lastErrors };
}

export const getActiveVersions = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => loadWatchlistCoverage(ctx, args.now),
});

const ENTRY_PAGE_SIZE = 500;

// Returns only the fields screening needs, to keep each page small.
export const getEntryPage = internalQuery({
  args: {
    versionId: v.id("watchlistVersions"),
    cursor: v.optional(v.string()),
    numItems: v.number(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("watchlistEntries")
      .withIndex("by_version", (query) => query.eq("versionId", args.versionId))
      .paginate({
        numItems: Math.min(Math.max(Math.floor(args.numItems), 1), ENTRY_PAGE_SIZE),
        cursor: args.cursor ?? null,
      });
    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      page: result.page.map((entry) => ({
        _id: entry._id,
        versionId: entry.versionId,
        sourceKey: entry.sourceKey,
        sourceRecordId: entry.sourceRecordId,
        entityType: entry.entityType,
        primaryName: entry.primaryName,
        aliases: entry.aliases,
        normalizedNames: entry.normalizedNames,
        countries: entry.countries,
        programs: entry.programs,
        isActive: entry.isActive,
      })),
    };
  },
});

export const riskCategoryValidator = v.union(
  v.literal("sanctions"),
  v.literal("pep"),
  v.literal("special_interest"),
  v.literal("fitness_probity"),
  v.literal("adverse_media"),
  v.literal("insolvency"),
);
export const pepClassValidator = v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4));

export const pepPositionValidator = v.object({
  title: v.string(),
  country: v.union(v.string(), v.null()),
  topics: v.array(v.string()),
  startDate: v.union(v.string(), v.null()),
  endDate: v.union(v.string(), v.null()),
  current: v.boolean(),
});

const monitoredHitSummaryValidator = v.object({
  key: v.string(),
  entityName: v.string(),
  categories: v.array(riskCategoryValidator),
  pepClass: v.optional(pepClassValidator),
});

const completeArgs = {
  verificationId: v.id("verifications"),
  clientId: v.id("clients"),
  subjectName: v.string(),
  verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
  reason: v.string(),
  confidence: v.optional(v.number()),
  // False when watchlist coverage was incomplete: the client is not billed
  // for our outage here (resolution through the review queue bills it).
  chargeCredits: v.optional(v.boolean()),
  // True when every source was screened. A complete enrolment screening
  // sets the monitoring baseline. Defaults to chargeCredits.
  complete: v.optional(v.boolean()),
  // Set on alerts raised by ongoing monitoring (amlMonitoring._recordRun).
  monitoring: v.optional(
    v.object({
      subjectId: v.id("amlMonitoredSubjects"),
      reference: v.string(),
      externalRef: v.optional(v.string()),
      added: v.array(monitoredHitSummaryValidator),
      escalated: v.array(monitoredHitSummaryValidator),
    }),
  ),
  coverage: v.optional(
    v.object({
      checked: v.array(
        v.object({
          versionId: v.id("watchlistVersions"),
          sourceKey: sourceKeyValidator,
          fetchedAt: v.number(),
          stale: v.boolean(),
        }),
      ),
      missing: v.array(sourceKeyValidator),
      stale: v.array(sourceKeyValidator),
      openSanctions: v.optional(openSanctionsStatusValidator),
      adverseMedia: v.optional(
        v.union(v.literal("screened"), v.literal("unavailable"), v.literal("not_configured"), v.literal("disabled")),
      ),
    }),
  ),
  matches: v.array(
    v.object({
      // Only set for Sentinel-owned watchlist matches.
      entryId: v.optional(v.id("watchlistEntries")),
      versionId: v.optional(v.id("watchlistVersions")),
      source: v.union(sourceKeyValidator, v.literal("OPENSANCTIONS"), v.literal("ADVERSE_MEDIA")),
      sourceRecordId: v.string(),
      entityName: v.string(),
      program: v.string(),
      matchScore: v.number(),
      matchMethod: v.union(
        v.literal("exact"),
        v.literal("normalized"),
        v.literal("alias"),
        v.literal("fuzzy"),
        v.literal("provider_score"),
        v.literal("ai_classification"),
      ),
      matchedCountry: v.optional(v.string()),
      countryMatch: v.optional(v.union(v.literal("match"), v.literal("mismatch"), v.literal("unknown"))),
      riskLevel: v.union(v.literal("critical"), v.literal("high")),
      topics: v.optional(v.array(v.string())),
      datasets: v.optional(v.array(v.string())),
      categories: v.optional(v.array(riskCategoryValidator)),
      pepClass: v.optional(pepClassValidator),
      birthDateMatch: v.optional(v.union(v.literal("match"), v.literal("mismatch"), v.literal("unknown"))),
      pepStatus: v.optional(v.union(v.literal("current"), v.literal("former"), v.literal("unknown"))),
      pepPositions: v.optional(v.array(pepPositionValidator)),
      // Adverse media hits: the article and how it was classified.
      media: v.optional(
        v.object({
          url: v.string(),
          title: v.string(),
          domain: v.union(v.string(), v.null()),
          publishedAt: v.union(v.string(), v.null()),
          language: v.union(v.string(), v.null()),
          sourceCountry: v.union(v.string(), v.null()),
          aboutSubject: v.union(v.literal("yes"), v.literal("no"), v.literal("unclear")),
          severity: v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high")),
          riskTypes: v.array(v.string()),
          summary: v.string(),
        }),
      ),
    }),
  ),
};

const completeArgsValidator = v.object(completeArgs);
export type CompleteScreeningArgs = Infer<typeof completeArgsValidator>;

export const complete = internalMutation({
  args: completeArgs,
  handler: async (ctx, args) => completeScreening(ctx, args),
});

// Stores a finished AML screening: result, flags, review item, credits,
// audit and webhook. Also used for alerts raised by ongoing monitoring.
export async function completeScreening(ctx: MutationCtx, args: CompleteScreeningArgs) {
  const verification = await ctx.db.get(args.verificationId);
  if (!verification) return;
  // Already terminal (e.g. a duplicate run): don't double-insert flags,
  // review rows or charges.
  if (verification.status === "completed") return;

  const now = Date.now();
  await ctx.db.patch(args.verificationId, {
    status: "completed",
    verdict: args.verdict,
    confidence:
      args.confidence ??
      (args.matches[0]?.matchScore === undefined ? 1 : args.matches[0].matchScore / 100),
    result: {
      provider: "sentinel_watchlists",
      subjectName: args.subjectName,
      reason: args.reason,
      matches: args.matches,
      ...(args.monitoring ? { monitoring: args.monitoring } : {}),
      categories: summarizeCategories(
        args.matches.map((match) => ({ categories: match.categories ?? [], pepClass: match.pepClass ?? null })),
      ),
      ...(args.coverage
        ? {
            coverage: {
              checkedSources: args.coverage.checked.map((row) => ({
                sourceKey: row.sourceKey,
                fetchedAt: row.fetchedAt,
                stale: row.stale,
              })),
              missingSources: args.coverage.missing,
              staleSources: args.coverage.stale,
              openSanctions: args.coverage.openSanctions ?? null,
              adverseMedia: args.coverage.adverseMedia ?? null,
            },
          }
        : {}),
    },
    updatedAt: now,
    completedAt: now,
  });
  for (const match of args.matches) {
    await ctx.db.insert("flaggedEntities", {
      entityName: match.entityName,
      source: match.source,
      program: match.program,
      matchScore: match.matchScore,
      clientId: args.clientId,
      verificationId: args.verificationId,
      watchlistVersionId: match.versionId,
      watchlistEntryId: match.entryId,
      ...(match.source === "OPENSANCTIONS"
        ? { externalId: match.sourceRecordId, topics: match.topics, datasets: match.datasets }
        : {}),
      ...(match.source === "ADVERSE_MEDIA" && match.media
        ? { externalId: match.media.url, topics: match.media.riskTypes, datasets: match.media.domain ? [match.media.domain] : [] }
        : {}),
      ...(match.categories ? { categories: match.categories } : {}),
      ...(match.pepClass ? { pepClass: match.pepClass } : {}),
      ...(match.pepStatus ? { pepStatus: match.pepStatus } : {}),
      matchMethod: match.matchMethod,
      riskLevel: match.riskLevel,
      matchedCountry: match.matchedCountry,
      createdAt: now,
    });
  }
  if (args.verdict !== "pass") {
    await ctx.db.insert("reviewQueue", {
      verificationId: args.verificationId,
      clientId: args.clientId,
      triggerType: "auto_escalation",
      triggerReason: args.reason,
      priority: args.verdict === "reject" ? "high" : "normal",
      status: "pending",
      createdAt: now,
    });
  }
  if (args.chargeCredits ?? true) {
    // Idempotent per verification: reviewQueue.resolve can't double-bill.
    await chargeVerification(ctx, {
      clientId: args.clientId,
      verificationId: args.verificationId,
      amount: verification.creditsUsed,
      reason: `AML sanctions screening: ${args.verdict}`,
    });
  }
  await ctx.db.insert("auditLog", {
    actorId: "system",
    actorType: "system",
    action: args.monitoring ? "aml.monitoring_alert" : "aml.screened",
    targetType: "verification",
    targetId: args.verificationId,
    clientId: args.clientId,
    metadata: {
      subjectName: args.subjectName,
      verdict: args.verdict,
      matchCount: args.matches.length,
      sourceVersions: [...new Set(args.matches.flatMap((match) => (match.versionId ? [match.versionId] : [])))],
      checkedVersions: args.coverage?.checked.map((row) => row.versionId) ?? [],
      missingSources: args.coverage?.missing ?? [],
      staleSources: args.coverage?.stale ?? [],
      openSanctions: args.coverage?.openSanctions ?? null,
      openSanctionsEntityIds: args.matches
        .filter((match) => match.source === "OPENSANCTIONS")
        .map((match) => match.sourceRecordId),
      ...(args.monitoring
        ? { monitoredSubject: args.monitoring.reference, added: args.monitoring.added.length, escalated: args.monitoring.escalated.length }
        : {}),
    },
    timestamp: now,
  });
  if (!args.monitoring && (args.complete ?? args.chargeCredits ?? true)) {
    await setBaselineFromEnrolment(ctx, args.verificationId, args.matches);
  }
  await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
    verificationId: args.verificationId,
  });
}
