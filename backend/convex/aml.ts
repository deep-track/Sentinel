import { ConvexError, v } from "convex/values";
import { internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { assertCreditsForNewVerification, creditsForType } from "./lib/verificationTypes";
import {
  SOURCE_LABELS,
  STRONG_MATCH_THRESHOLD,
  compareCandidates,
  decide,
  joinList,
  scoreCandidate,
  type Candidate,
  type SourceKey,
} from "./lib/amlMatching";

const internalApi: any = internal;

const MATCH_LIMIT = 25;
const ENTRY_PAGE_SIZE = 500;

export const submit = mutation({
  args: {
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const subjectName = args.subjectName.trim();
    if (!subjectName) throw new ConvexError({ code: "invalid_argument", message: "Subject name is required." });
    if (subjectName.length > 300) throw new ConvexError({ code: "invalid_argument", message: "Subject name is too long." });
    const country = args.country?.trim() || undefined;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    const creditsUsed = creditsForType("aml");
    // Balance check in the same transaction as the insert.
    await assertCreditsForNewVerification(ctx, args.clientId, creditsUsed);
    const now = Date.now();
    const verificationId = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "aml",
      status: "queued",
      creditsUsed,
      input: { subjectName, entityType: args.entityType, country: country ?? null },
      reference: `aml_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internalApi.aml.runScreening, {
      verificationId,
      clientId: args.clientId,
      subjectName,
      entityType: args.entityType,
      country,
    });
    return { verificationId };
  },
});

type Entry = {
  _id: Id<"watchlistEntries">;
  versionId: Id<"watchlistVersions">;
  sourceKey: SourceKey;
  sourceRecordId: string;
  entityType: "individual" | "entity" | "unknown";
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  programs: string[];
  isActive: boolean;
};

type Coverage = {
  versions: Array<{
    _id: Id<"watchlistVersions">;
    sourceKey: SourceKey;
    fetchedAt: number;
    recordCount: number;
    stale: boolean;
  }>;
  missing: SourceKey[];
  stale: SourceKey[];
};

function describeCoverageGaps(coverage: Coverage): string {
  const gaps = [
    ...coverage.missing.map((key) => `${SOURCE_LABELS[key]} unavailable`),
    ...coverage.versions
      .filter((version) => version.stale)
      .map((version) => `${SOURCE_LABELS[version.sourceKey]} stale (last fetched ${new Date(version.fetchedAt).toISOString().slice(0, 10)})`),
  ];
  return gaps.join("; ");
}

// Builds the final verdict and reason. The reason only names lists that were
// actually screened, and incomplete coverage can never produce "pass".
function finalDecision(candidates: Array<Candidate<Entry>>, coverage: Coverage) {
  const decision = decide(candidates);
  const fresh = coverage.versions.filter((version) => !version.stale).map((version) => SOURCE_LABELS[version.sourceKey]);
  const staleChecked = coverage.versions.filter((version) => version.stale).map((version) => `${SOURCE_LABELS[version.sourceKey]} (stale)`);
  const checked = [...fresh, ...staleChecked];
  const complete = coverage.missing.length === 0 && coverage.stale.length === 0;

  if (complete) {
    return {
      verdict: decision.verdict,
      reason: decision.verdict === "pass" ? `No match found on the ${joinList(checked, "or")} watchlists.` : decision.reason,
      complete,
    };
  }

  const gaps = describeCoverageGaps(coverage);
  if (decision.verdict === "reject") {
    return { verdict: "reject" as const, reason: `${decision.reason} Watchlist coverage incomplete: ${gaps}.`, complete };
  }
  const screened =
    decision.verdict === "pass"
      ? checked.length > 0
        ? `No match found on ${joinList(checked, "or")}, but screening is incomplete.`
        : "No watchlist could be screened."
      : decision.reason;
  return {
    verdict: "review" as const,
    reason: `Watchlist unavailable or stale (${gaps}) — held for manual review. ${screened}`,
    complete,
  };
}

export const runScreening = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.verifications._markProcessing, { id: args.verificationId });
    try {
      const coverage: Coverage = await ctx.runQuery(internalApi.amlPersistence.getActiveVersions, { now: Date.now() });
      const candidates: Array<Candidate<Entry>> = [];
      for (const version of coverage.versions) {
        let cursor: string | undefined;
        while (true) {
          const page = await ctx.runQuery(internalApi.amlPersistence.getEntryPage, {
            versionId: version._id,
            cursor,
            numItems: ENTRY_PAGE_SIZE,
          });
          for (const entry of page.page as Entry[]) {
            const candidate = scoreCandidate(args.subjectName, args.entityType, args.country, entry);
            if (candidate) candidates.push(candidate);
          }
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
      }
      candidates.sort(compareCandidates);
      // Decide on ALL candidates, then keep only the strongest for storage.
      const decision = finalDecision(candidates, coverage);
      const stored = candidates.slice(0, MATCH_LIMIT);
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: args.verificationId,
        clientId: args.clientId,
        subjectName: args.subjectName,
        verdict: decision.verdict,
        reason: decision.reason,
        confidence: !decision.complete && stored.length === 0 ? 0 : undefined,
        chargeCredits: decision.complete,
        coverage: {
          checked: coverage.versions.map((version) => ({
            versionId: version._id,
            sourceKey: version.sourceKey,
            fetchedAt: version.fetchedAt,
            stale: version.stale,
          })),
          missing: coverage.missing,
          stale: coverage.stale,
        },
        matches: stored.map((match) => ({
          entryId: match._id,
          versionId: match.versionId,
          source: match.sourceKey,
          sourceRecordId: match.sourceRecordId,
          entityName: match.primaryName,
          program: match.programs[0] ?? "unknown",
          matchScore: match.nameScore,
          matchMethod: match.method,
          matchedCountry: match.countries[0],
          countryMatch: match.countryMatch,
          riskLevel: match.nameScore >= STRONG_MATCH_THRESHOLD ? ("critical" as const) : ("high" as const),
        })),
      });
      return { verdict: decision.verdict, matches: candidates.length };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "AML screening failed";
      await ctx.runMutation(internalApi.verifications._fail, { id: args.verificationId, reason: "AML screening unavailable; manual operational review required." });
      await ctx.runMutation(internalApi.auditLog._log, {
        actorId: "system",
        actorType: "system",
        action: "aml.screening_failed",
        targetType: "verification",
        targetId: args.verificationId,
        clientId: args.clientId,
        metadata: { reason: reason.slice(0, 500) },
      });
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
        verificationId: args.verificationId,
      });
      throw error;
    }
  },
});
