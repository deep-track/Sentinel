import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInternalUser } from "./lib/rbac";

// Per-source read cap for the monitoring window. Counts are computed over
// everything read (before the display slice); `truncated` flags a hit cap.
const MAX_WINDOW_ROWS = 2000;

export const overview = query({
  args: { windowMs: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const windowMs = Math.min(Math.max(args.windowMs ?? 7 * 24 * 60 * 60 * 1000, 60 * 60 * 1000), 90 * 24 * 60 * 60 * 1000);
    const limit = Math.min(Math.max(args.limit ?? 25, 5), 100);
    const since = Date.now() - windowMs;

    const scopedReviews = await ctx.db
      .query("reviewQueue")
      .withIndex("by_created_at", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(MAX_WINDOW_ROWS);
    const reviewCounts = {
      pending: scopedReviews.filter((review) => review.status === "pending").length,
      inReview: scopedReviews.filter((review) => review.status === "in_review").length,
      resolved: scopedReviews.filter((review) => review.status === "resolved").length,
      highPriority: scopedReviews.filter((review) => review.priority === "high" && review.status !== "resolved").length,
    };

    // exportData can be large; the overview only needs the summary fields.
    const recentReports = (
      await ctx.db.query("complianceReports").withIndex("by_generated_at").order("desc").take(5)
    ).map(({ exportData: _exportData, ...report }) => report);

    const [screenedEvents, failedEvents] = await Promise.all(
      (["aml.screened", "aml.screening_failed"] as const).map((action) =>
        ctx.db
          .query("auditLog")
          .withIndex("by_action_and_timestamp", (q) => q.eq("action", action).gte("timestamp", since))
          .order("desc")
          .take(MAX_WINDOW_ROWS),
      ),
    );
    const verdictOf = (event: { metadata?: unknown }) =>
      (event.metadata as { verdict?: string } | undefined)?.verdict;
    const screeningCounts = {
      screened: screenedEvents.length,
      failed: failedEvents.length,
      review: screenedEvents.filter((event) => verdictOf(event) === "review").length,
      reject: screenedEvents.filter((event) => verdictOf(event) === "reject").length,
      pass: screenedEvents.filter((event) => verdictOf(event) === "pass").length,
    };
    const auditEvents = [...screenedEvents, ...failedEvents]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);

    return {
      windowMs,
      generatedAt: Date.now(),
      reviewCounts,
      screeningCounts,
      truncated:
        scopedReviews.length === MAX_WINDOW_ROWS ||
        screenedEvents.length === MAX_WINDOW_ROWS ||
        failedEvents.length === MAX_WINDOW_ROWS,
      reviews: scopedReviews.slice(0, limit),
      auditEvents,
      recentReports,
    };
  },
});
