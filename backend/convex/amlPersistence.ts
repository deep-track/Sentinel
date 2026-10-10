import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chargeVerification } from "./lib/credits";
import { MAX_LIST_AGE_MS, SOURCE_KEYS, type SourceKey } from "./lib/amlMatching";

const sourceKeyValidator = v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"));

// Coverage check for screening. Returns the newest active version of every
// source, and lists which sources are missing (no active version) or stale
// (older than the max age for the source's cadence). Screening is only allowed
// to auto-pass when both lists are empty. `now` is passed in because queries
// must not read the wall clock.
export const getActiveVersions = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const versions: Array<{
      _id: Id<"watchlistVersions">;
      sourceKey: SourceKey;
      fetchedAt: number;
      recordCount: number;
      stale: boolean;
    }> = [];
    const missing: SourceKey[] = [];
    const stale: SourceKey[] = [];
    for (const sourceKey of SOURCE_KEYS) {
      const source = await ctx.db
        .query("watchlistSources")
        .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
        .first();
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
      const isStale = args.now - active.fetchedAt > maxAge;
      if (isStale) stale.push(sourceKey);
      versions.push({
        _id: active._id,
        sourceKey,
        fetchedAt: active.fetchedAt,
        recordCount: active.recordCount,
        stale: isStale,
      });
    }
    return { versions, missing, stale };
  },
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

export const complete = internalMutation({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    subjectName: v.string(),
    verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    reason: v.string(),
    confidence: v.optional(v.number()),
    // False when watchlist coverage was incomplete: the client is not billed
    // for our outage here (resolution through the review queue bills it).
    chargeCredits: v.optional(v.boolean()),
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
      }),
    ),
    matches: v.array(
      v.object({
        entryId: v.id("watchlistEntries"),
        versionId: v.id("watchlistVersions"),
        source: sourceKeyValidator,
        sourceRecordId: v.string(),
        entityName: v.string(),
        program: v.string(),
        matchScore: v.number(),
        matchMethod: v.union(v.literal("exact"), v.literal("normalized"), v.literal("alias"), v.literal("fuzzy")),
        matchedCountry: v.optional(v.string()),
        countryMatch: v.optional(v.union(v.literal("match"), v.literal("mismatch"), v.literal("unknown"))),
        riskLevel: v.union(v.literal("critical"), v.literal("high")),
      }),
    ),
  },
  handler: async (ctx, args) => {
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
      action: "aml.screened",
      targetType: "verification",
      targetId: args.verificationId,
      clientId: args.clientId,
      metadata: {
        subjectName: args.subjectName,
        verdict: args.verdict,
        matchCount: args.matches.length,
        sourceVersions: [...new Set(args.matches.map((match) => match.versionId))],
        checkedVersions: args.coverage?.checked.map((row) => row.versionId) ?? [],
        missingSources: args.coverage?.missing ?? [],
        staleSources: args.coverage?.stale ?? [],
      },
      timestamp: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
      verificationId: args.verificationId,
    });
  },
});
