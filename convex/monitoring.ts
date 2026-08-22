import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInternalUser } from "./lib/rbac";

export const overview = query({
  args: { windowMs: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const windowMs = Math.min(Math.max(args.windowMs ?? 7 * 24 * 60 * 60 * 1000, 60 * 60 * 1000), 90 * 24 * 60 * 60 * 1000);
    const limit = Math.min(Math.max(args.limit ?? 25, 5), 100);
    const since = Date.now() - windowMs;

    const reviews = await ctx.db.query("reviewQueue").collect();
    const scopedReviews = reviews.filter((review) => review.createdAt >= since);
    const reviewCounts = {
      pending: scopedReviews.filter((review) => review.status === "pending").length,
      inReview: scopedReviews.filter((review) => review.status === "in_review").length,
      resolved: scopedReviews.filter((review) => review.status === "resolved").length,
      highPriority: scopedReviews.filter((review) => review.priority === "high" && review.status !== "resolved").length,
    };

    const recentReports = await ctx.db.query("complianceReports")
      .withIndex("by_generated_at")
      .order("desc")
      .take(5);

    const auditRows = await ctx.db.query("auditLog").collect();
    const amlEvents = auditRows
      .filter((event) =>
        (event.action === "aml.screened" || event.action === "aml.screening_failed") &&
        event.timestamp >= since,
      )
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
    const screeningCounts = {
      screened: amlEvents.filter((event) => event.action === "aml.screened").length,
      failed: amlEvents.filter((event) => event.action === "aml.screening_failed").length,
      review: amlEvents.filter((event) => event.action === "aml.screened" && (event.metadata as { verdict?: string } | undefined)?.verdict === "review").length,
      reject: amlEvents.filter((event) => event.action === "aml.screened" && (event.metadata as { verdict?: string } | undefined)?.verdict === "reject").length,
      pass: amlEvents.filter((event) => event.action === "aml.screened" && (event.metadata as { verdict?: string } | undefined)?.verdict === "pass").length,
    };

    return {
      windowMs,
      generatedAt: Date.now(),
      reviewCounts,
      screeningCounts,
      reviews: scopedReviews.sort((left, right) => right.createdAt - left.createdAt).slice(0, limit),
      auditEvents: amlEvents,
      recentReports,
    };
  },
});
