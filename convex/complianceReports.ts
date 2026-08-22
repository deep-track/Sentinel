import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireInternalUser } from "./lib/rbac";
import { sha256Hex } from "./lib/crypto";

const internalApi: any = internal;
const PAGE_SIZE = 100;
const EXPORT_LIMIT = 5000;

type PageArgs = { from: number; to: number; cursor?: string; numItems: number };

export const verificationPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.optional(v.string()), numItems: v.number() },
  handler: async (ctx, args: PageArgs) => ctx.db.query("verifications")
    .withIndex("by_created_at", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

export const auditPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.optional(v.string()), numItems: v.number() },
  handler: async (ctx, args: PageArgs) => ctx.db.query("auditLog")
    .withIndex("by_timestamp", (q) => q.gte("timestamp", args.from).lt("timestamp", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

export const reviewPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.optional(v.string()), numItems: v.number() },
  handler: async (ctx, args: PageArgs) => ctx.db.query("reviewQueue")
    .withIndex("by_created_at", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

export const store = internalMutation({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
    generatedAt: v.number(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    verificationCount: v.number(),
    amlVerificationCount: v.number(),
    completedCount: v.number(),
    failedCount: v.number(),
    passCount: v.number(),
    reviewCount: v.number(),
    rejectCount: v.number(),
    reviewQueueCount: v.number(),
    screeningAuditCount: v.number(),
    screeningFailureCount: v.number(),
    exportData: v.any(),
    exportHash: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("complianceReports", { reportType: "weekly_compliance", ...args }),
});

export const generateWeekly = internalAction({
  args: {},
  handler: async (ctx): Promise<{ reportId: string; exportHash: string; verificationCount: number; screeningAuditCount: number }> => {
    const periodEnd = Date.now();
    const periodStart = periodEnd - 7 * 24 * 60 * 60 * 1000;
    const verifications: any[] = [];
    const audits: any[] = [];
    const reviews: any[] = [];

    try {
      for (const [target, output] of [
        [internalApi.complianceReports.verificationPage, verifications],
        [internalApi.complianceReports.auditPage, audits],
        [internalApi.complianceReports.reviewPage, reviews],
      ] as const) {
        let cursor: string | undefined;
        while (true) {
          const page = await ctx.runQuery(target, { from: periodStart, to: periodEnd, cursor, numItems: PAGE_SIZE });
          output.push(...page.page.slice(0, Math.max(0, EXPORT_LIMIT - output.length)));
          if (page.isDone || output.length >= EXPORT_LIMIT) break;
          cursor = page.continueCursor;
        }
      }

      const amlVerifications = verifications.filter((row) => row.type === "aml");
      const screeningAudits = audits.filter((row) => row.action === "aml.screened" || row.action === "aml.screening_failed");
      const exportData = {
        generatedAt: periodEnd,
        periodStart,
        periodEnd,
        verifications: verifications.map((row) => ({ id: row._id, reference: row.reference, clientId: row.clientId, type: row.type, status: row.status, verdict: row.verdict ?? null, confidence: row.confidence ?? null, createdAt: row.createdAt, completedAt: row.completedAt ?? null })),
        reviews: reviews.map((row) => ({ id: row._id, verificationId: row.verificationId, clientId: row.clientId, priority: row.priority, status: row.status, triggerType: row.triggerType, createdAt: row.createdAt, resolvedAt: row.resolvedAt ?? null })),
        screeningAudit: screeningAudits.map((row) => ({ id: row._id, action: row.action, targetId: row.targetId, clientId: row.clientId ?? null, metadata: row.metadata ?? null, timestamp: row.timestamp })),
      };
      const exportJson = JSON.stringify(exportData);
      const exportHash = await sha256Hex(exportJson);
      const reportId = await ctx.runMutation(internalApi.complianceReports.store, {
        periodStart,
        periodEnd,
        generatedAt: periodEnd,
        status: "completed",
        verificationCount: verifications.length,
        amlVerificationCount: amlVerifications.length,
        completedCount: verifications.filter((row) => row.status === "completed").length,
        failedCount: verifications.filter((row) => row.status === "failed").length,
        passCount: amlVerifications.filter((row) => row.verdict === "pass").length,
        reviewCount: amlVerifications.filter((row) => row.verdict === "review").length,
        rejectCount: amlVerifications.filter((row) => row.verdict === "reject").length,
        reviewQueueCount: reviews.length,
        screeningAuditCount: screeningAudits.filter((row) => row.action === "aml.screened").length,
        screeningFailureCount: screeningAudits.filter((row) => row.action === "aml.screening_failed").length,
        exportData,
        exportHash,
      });
      return { reportId, exportHash, verificationCount: verifications.length, screeningAuditCount: screeningAudits.length };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Weekly compliance report failed";
      const reportId = await ctx.runMutation(internalApi.complianceReports.store, {
        periodStart,
        periodEnd,
        generatedAt: periodEnd,
        status: "failed",
        verificationCount: verifications.length,
        amlVerificationCount: verifications.filter((row) => row.type === "aml").length,
        completedCount: 0,
        failedCount: 0,
        passCount: 0,
        reviewCount: 0,
        rejectCount: 0,
        reviewQueueCount: reviews.length,
        screeningAuditCount: 0,
        screeningFailureCount: 0,
        exportData: { periodStart, periodEnd, partial: true },
        exportHash: "",
        failureReason: reason.slice(0, 500),
      });
      return { reportId, exportHash: "", verificationCount: verifications.length, screeningAuditCount: 0 };
    }
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    return await ctx.db.query("complianceReports")
      .withIndex("by_generated_at")
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 10, 1), 50));
  },
});
