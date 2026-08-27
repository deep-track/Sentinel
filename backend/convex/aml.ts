import { ConvexError, v } from "convex/values";
import { internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";

const internalApi: any = internal;

const MATCH_LIMIT = 25;
const FUZZY_REVIEW_THRESHOLD = 70;
const FUZZY_REJECT_THRESHOLD = 94;
const AML_CREDIT_COST = 1;

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
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    const now = Date.now();
    const verificationId = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "aml",
      status: "queued",
      creditsUsed: AML_CREDIT_COST,
      input: { subjectName, entityType: args.entityType, country: args.country ?? null },
      reference: `aml_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internalApi.aml.runScreening, {
      verificationId,
      clientId: args.clientId,
      subjectName,
      entityType: args.entityType,
      country: args.country,
    });
    return { verificationId };
  },
});

type Entry = {
  _id: Id<"watchlistEntries">;
  versionId: Id<"watchlistVersions">;
  sourceKey: "OFAC_SDN" | "UN_CONSOLIDATED";
  sourceRecordId: string;
  entityType: "individual" | "entity" | "unknown";
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  programs: string[];
  isActive: boolean;
};

type Candidate = Entry & { nameScore: number; method: "exact" | "normalized" | "alias" | "fuzzy" };

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, " ");
  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) result.add(compact.slice(index, index + 2));
  return result;
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let overlap = 0;
  for (const value of leftBigrams) if (rightBigrams.has(value)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size || 1);
}

function scoreCandidate(subject: string, entry: Entry): Candidate | null {
  const normalizedSubject = normalize(subject);
  if (!normalizedSubject || !entry.isActive) return null;
  const names = [entry.primaryName, ...entry.aliases, ...entry.normalizedNames].map(normalize).filter(Boolean);
  let bestScore = 0;
  let method: Candidate["method"] = "fuzzy";
  for (const candidate of names) {
    if (candidate === normalizedSubject) {
      bestScore = 1;
      method = candidate === normalize(entry.primaryName) ? "normalized" : "alias";
      break;
    }
    const score = diceSimilarity(normalizedSubject, candidate);
    if (score > bestScore) bestScore = score;
  }
  const nameScore = Math.round(bestScore * 100);
  return nameScore < FUZZY_REVIEW_THRESHOLD ? null : { ...entry, nameScore, method };
}

function decide(matches: Candidate[]): { verdict: "pass" | "review" | "reject"; reason: string } {
  if (matches.length === 0) return { verdict: "pass", reason: "No OFAC or UN watchlist match found." };
  const strongest = matches[0];
  if (strongest.method !== "fuzzy" && strongest.nameScore >= FUZZY_REJECT_THRESHOLD) {
    return { verdict: "reject", reason: "Exact or normalized sanctions-list match requires compliance escalation." };
  }
  if (strongest.nameScore >= FUZZY_REJECT_THRESHOLD) {
    return { verdict: "review", reason: "High-confidence fuzzy match requires human identity resolution." };
  }
  return { verdict: "review", reason: "Potential sanctions-list match requires human review." };
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
      const activeVersions = await ctx.runQuery(internalApi.amlPersistence.getActiveVersions, {});
      const candidates: Candidate[] = [];
      for (const version of activeVersions) {
        let cursor: string | undefined;
        while (true) {
          const page = await ctx.runQuery(internalApi.amlPersistence.getEntryPage, {
            versionId: version._id,
            cursor,
            numItems: 150,
          });
          for (const entry of page.page as Entry[]) {
            const candidate = scoreCandidate(args.subjectName, entry);
            if (candidate) candidates.push(candidate);
          }
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
      }
      candidates.sort((left: Candidate, right: Candidate) => right.nameScore - left.nameScore);
      candidates.splice(MATCH_LIMIT);
      const decision = decide(candidates);
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: args.verificationId,
        clientId: args.clientId,
        subjectName: args.subjectName,
        verdict: decision.verdict,
        reason: decision.reason,
        matches: candidates.map((match: Candidate) => ({
          entryId: match._id,
          versionId: match.versionId,
          source: match.sourceKey,
          sourceRecordId: match.sourceRecordId,
          entityName: match.primaryName,
          program: match.programs[0] ?? "unknown",
          matchScore: match.nameScore,
          matchMethod: match.method,
          matchedCountry: match.countries[0],
          riskLevel: match.nameScore >= FUZZY_REJECT_THRESHOLD ? "critical" as const : "high" as const,
        })),
      });
      await ctx.runMutation(internalApi.creditLedger._insertLedgerEntry, {
        clientId: args.clientId,
        verificationId: args.verificationId,
        type: "deduction",
        amount: -AML_CREDIT_COST,
        reason: `AML sanctions screening: ${decision.verdict}`,
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
      throw error;
    }
  },
});
