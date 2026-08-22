import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getActiveVersions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const versions = await ctx.db.query("watchlistVersions").collect();
    const activeVersions = versions.filter((version) => version.status === "active");
    if (activeVersions.length === 0) {
      throw new ConvexError("No active watchlist version is available");
    }
    return activeVersions.map((version) => ({ _id: version._id, sourceKey: version.sourceKey }));
  },
});

export const getEntryPage = internalQuery({
  args: {
    versionId: v.id("watchlistVersions"),
    cursor: v.optional(v.string()),
    numItems: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("watchlistEntries")
      .withIndex("by_version", (query) => query.eq("versionId", args.versionId))
      .paginate({ numItems: Math.min(Math.max(args.numItems, 1), 150), cursor: args.cursor ?? null });
  },
});

export const complete = internalMutation({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    subjectName: v.string(),
    verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    reason: v.string(),
    matches: v.array(
      v.object({
        entryId: v.id("watchlistEntries"),
        versionId: v.id("watchlistVersions"),
        source: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
        sourceRecordId: v.string(),
        entityName: v.string(),
        program: v.string(),
        matchScore: v.number(),
        matchMethod: v.union(v.literal("exact"), v.literal("normalized"), v.literal("alias"), v.literal("fuzzy")),
        matchedCountry: v.optional(v.string()),
        riskLevel: v.union(v.literal("critical"), v.literal("high")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.verificationId, {
      status: "completed",
      verdict: args.verdict,
      confidence: args.matches[0]?.matchScore === undefined ? 1 : args.matches[0].matchScore / 100,
      result: { provider: "sentinel_watchlists", subjectName: args.subjectName, reason: args.reason, matches: args.matches },
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
      },
      timestamp: now,
    });
  },
});
