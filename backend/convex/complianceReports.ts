import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireInternalUser } from "./lib/rbac";
import { sha256Hex } from "./lib/crypto";

const PAGE_SIZE = 100;
// Per-source row cap. Hitting it sets `truncated` on the report so counts are
// known to be lower bounds instead of silently wrong.
const EXPORT_LIMIT = 5000;

const pageArgs = { from: v.number(), to: v.number(), cursor: v.optional(v.string()), numItems: v.number() };
type PageArgs = { from: number; to: number; cursor?: string; numItems: number };

export const verificationPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args: PageArgs) => ctx.db.query("verifications")
    .withIndex("by_created_at", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

// AML rows read through their own index so the AML counts don't depend on
// how many other verifications fit under the export cap.
export const amlVerificationPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args: PageArgs) => ctx.db.query("verifications")
    .withIndex("by_type_and_created_at", (q) => q.eq("type", "aml").gte("createdAt", args.from).lt("createdAt", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

export const auditPage = internalQuery({
  args: { ...pageArgs, action: v.string() },
  handler: async (ctx, args: PageArgs & { action: string }) => ctx.db.query("auditLog")
    .withIndex("by_action_and_timestamp", (q) => q.eq("action", args.action).gte("timestamp", args.from).lt("timestamp", args.to))
    .paginate({ numItems: Math.min(args.numItems, PAGE_SIZE), cursor: args.cursor ?? null }),
});

export const reviewPage = internalQuery({
  args: pageArgs,
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
    exportStorageId: v.optional(v.id("_storage")),
    truncated: v.optional(v.boolean()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("complianceReports", { reportType: "weekly_compliance", ...args }),
});

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

async function collectPages<T>(fetchPage: (cursor?: string) => Promise<Page<T>>) {
  const rows: T[] = [];
  let truncated = false;
  let cursor: string | undefined;
  while (true) {
    const page = await fetchPage(cursor);
    const room = EXPORT_LIMIT - rows.length;
    rows.push(...page.page.slice(0, room));
    if (page.page.length > room) {
      truncated = true;
      break;
    }
    if (page.isDone) break;
    if (rows.length >= EXPORT_LIMIT) {
      truncated = true;
      break;
    }
    cursor = page.continueCursor;
  }
  return { rows, truncated };
}

export const generateWeekly = internalAction({
  args: {},
  handler: async (ctx): Promise<{ reportId: Id<"complianceReports">; exportHash: string; verificationCount: number; screeningAuditCount: number }> => {
    const periodEnd = Date.now();
    const periodStart = periodEnd - 7 * 24 * 60 * 60 * 1000;
    const range = { from: periodStart, to: periodEnd, numItems: PAGE_SIZE };
    let verificationCount = 0;
    let amlVerificationCount = 0;
    let reviewQueueCount = 0;
    let storageId: Id<"_storage"> | undefined;

    try {
      const verifications = await collectPages<Doc<"verifications">>((cursor) =>
        ctx.runQuery(internal.complianceReports.verificationPage, { ...range, cursor }));
      verificationCount = verifications.rows.length;
      const amlVerifications = await collectPages<Doc<"verifications">>((cursor) =>
        ctx.runQuery(internal.complianceReports.amlVerificationPage, { ...range, cursor }));
      amlVerificationCount = amlVerifications.rows.length;
      const reviews = await collectPages<Doc<"reviewQueue">>((cursor) =>
        ctx.runQuery(internal.complianceReports.reviewPage, { ...range, cursor }));
      reviewQueueCount = reviews.rows.length;
      const screened = await collectPages<Doc<"auditLog">>((cursor) =>
        ctx.runQuery(internal.complianceReports.auditPage, { ...range, cursor, action: "aml.screened" }));
      const screeningFailed = await collectPages<Doc<"auditLog">>((cursor) =>
        ctx.runQuery(internal.complianceReports.auditPage, { ...range, cursor, action: "aml.screening_failed" }));

      const truncated = [verifications, amlVerifications, reviews, screened, screeningFailed].some((source) => source.truncated);
      const screeningAudits = [...screened.rows, ...screeningFailed.rows].sort((a, b) => a.timestamp - b.timestamp);
      const exportData = {
        generatedAt: periodEnd,
        periodStart,
        periodEnd,
        truncated,
        exportLimitPerSource: EXPORT_LIMIT,
        verifications: verifications.rows.map((row) => ({ id: row._id, reference: row.reference, clientId: row.clientId, type: row.type, status: row.status, verdict: row.verdict ?? null, confidence: row.confidence ?? null, createdAt: row.createdAt, completedAt: row.completedAt ?? null })),
        reviews: reviews.rows.map((row) => ({ id: row._id, verificationId: row.verificationId, clientId: row.clientId, priority: row.priority, status: row.status, triggerType: row.triggerType, createdAt: row.createdAt, resolvedAt: row.resolvedAt ?? null })),
        screeningAudit: screeningAudits.map((row) => ({ id: row._id, action: row.action, targetId: row.targetId, clientId: row.clientId ?? null, metadata: row.metadata ?? null, timestamp: row.timestamp })),
      };
      const exportJson = JSON.stringify(exportData);
      const exportHash = await sha256Hex(exportJson);
      // The full export can exceed Convex's 1 MiB document limit, so it lives
      // in file storage; the report row keeps a small manifest + the hash.
      storageId = await ctx.storage.store(new Blob([exportJson], { type: "application/json" }));
      const amlRows = amlVerifications.rows;
      const reportId: Id<"complianceReports"> = await ctx.runMutation(internal.complianceReports.store, {
        periodStart,
        periodEnd,
        generatedAt: periodEnd,
        status: "completed",
        verificationCount: verifications.rows.length,
        amlVerificationCount: amlRows.length,
        completedCount: verifications.rows.filter((row) => row.status === "completed").length,
        failedCount: verifications.rows.filter((row) => row.status === "failed").length,
        passCount: amlRows.filter((row) => row.verdict === "pass").length,
        reviewCount: amlRows.filter((row) => row.verdict === "review").length,
        rejectCount: amlRows.filter((row) => row.verdict === "reject").length,
        reviewQueueCount: reviews.rows.length,
        screeningAuditCount: screened.rows.length,
        screeningFailureCount: screeningFailed.rows.length,
        exportData: {
          storage: "file",
          generatedAt: periodEnd,
          periodStart,
          periodEnd,
          truncated,
          bytes: exportJson.length,
          rowCounts: {
            verifications: verifications.rows.length,
            reviews: reviews.rows.length,
            screeningAudit: screeningAudits.length,
          },
        },
        exportHash,
        exportStorageId: storageId,
        truncated,
      });
      return { reportId, exportHash, verificationCount: verifications.rows.length, screeningAuditCount: screeningAudits.length };
    } catch (error) {
      if (storageId) {
        await ctx.storage.delete(storageId).catch(() => undefined);
      }
      const reason = error instanceof Error ? error.message : "Weekly compliance report failed";
      const reportId: Id<"complianceReports"> = await ctx.runMutation(internal.complianceReports.store, {
        periodStart,
        periodEnd,
        generatedAt: periodEnd,
        status: "failed",
        verificationCount,
        amlVerificationCount,
        completedCount: 0,
        failedCount: 0,
        passCount: 0,
        reviewCount: 0,
        rejectCount: 0,
        reviewQueueCount,
        screeningAuditCount: 0,
        screeningFailureCount: 0,
        exportData: { periodStart, periodEnd, partial: true },
        exportHash: "",
        failureReason: reason.slice(0, 500),
      });
      return { reportId, exportHash: "", verificationCount, screeningAuditCount: 0 };
    }
  },
});

// Summary rows only: legacy reports may carry a large inline exportData.
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const reports = await ctx.db.query("complianceReports")
      .withIndex("by_generated_at")
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 10, 1), 50));
    return reports.map(({ exportData: _exportData, ...report }) => report);
  },
});

// Download link for a report's export. Reports generated before exports
// moved to file storage return their inline data instead.
export const getExport = query({
  args: { reportId: v.id("complianceReports") },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    if (report.exportStorageId) {
      return { url: await ctx.storage.getUrl(report.exportStorageId), exportHash: report.exportHash, inline: null };
    }
    return { url: null, exportHash: report.exportHash, inline: report.exportData };
  },
});
