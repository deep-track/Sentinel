import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { QUEUE_LABELS, REGULATOR_LABELS, loadClientSettings, queueForType, type Queue } from "./lib/clientSettings";
import { RISK_CATEGORIES, RISK_CATEGORY_LABELS } from "./lib/amlCategories";
import { profileNames } from "./userProfiles";

// The monthly compliance pack (Reports in the portal): checks by product and
// outcome, AML hits by category, review cases and turnaround, decisions per
// person, monitoring and STRs, for a calendar month in Kenya time (EAT,
// UTC+3). Printed to PDF from the page for the board, CBK or the FRC.

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_VERIFICATIONS = 5000;
const MAX_REVIEWS_PER_STATUS = 3000;

export function monthBounds(month: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new ConvexError({ code: "invalid_argument", message: "Month must be YYYY-MM." });
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) throw new ConvexError({ code: "invalid_argument", message: "Month must be YYYY-MM." });
  return { start: Date.UTC(year, index, 1) - EAT_OFFSET_MS, end: Date.UTC(year, index + 1, 1) - EAT_OFFSET_MS };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

type Outcome = "pass" | "review" | "reject" | "failed" | "pending";

function outcomeOf(row: Doc<"verifications">): Outcome {
  if (row.status === "failed") return "failed";
  if (row.status !== "completed") return "pending";
  return row.verdict ?? "review";
}

export const forMonth = query({
  args: { clientId: v.id("clients"), month: v.string() },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "reviewer", "viewer"]);
    const { start, end } = monthBounds(args.month);
    const [client, settings] = await Promise.all([ctx.db.get(args.clientId), loadClientSettings(ctx, args.clientId)]);
    if (!client) return null;

    // Checks run in the month (test-key sandbox results left out).
    const fetched = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId).gte("createdAt", start).lt("createdAt", end))
      .take(MAX_VERIFICATIONS + 1);
    const truncated = fetched.length > MAX_VERIFICATIONS;
    const checks = fetched.slice(0, MAX_VERIFICATIONS).filter((row) => !(row.input as { sandbox?: unknown } | null)?.sandbox);

    const byProduct = new Map<Queue, Record<Outcome | "total", number>>();
    let monitoringAlerts = 0;
    const amlHits = Object.fromEntries(RISK_CATEGORIES.map((category) => [category, 0])) as Record<string, number>;
    const pepClasses: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let amlScreenings = 0;
    for (const row of checks) {
      const product = queueForType(row.type);
      const counts = byProduct.get(product) ?? { total: 0, pass: 0, review: 0, reject: 0, failed: 0, pending: 0 };
      counts.total += 1;
      counts[outcomeOf(row)] += 1;
      byProduct.set(product, counts);
      if (row.type !== "aml") continue;
      const result = (row.result ?? {}) as { monitoring?: unknown; categories?: Record<string, { hits?: number; highestPepClass?: number | null }> };
      if (result.monitoring) monitoringAlerts += 1;
      else amlScreenings += 1;
      for (const category of RISK_CATEGORIES) {
        if ((result.categories?.[category]?.hits ?? 0) > 0) amlHits[category] += 1;
      }
      const pepClass = result.categories?.pep?.highestPepClass;
      if (pepClass) pepClasses[String(pepClass)] += 1;
    }

    // Review cases opened or closed in the month.
    const reviews = (
      await Promise.all(
        (["pending", "in_review", "resolved"] as const).map((status) =>
          ctx.db
            .query("reviewQueue")
            .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", status))
            .order("desc")
            .take(MAX_REVIEWS_PER_STATUS),
        ),
      )
    ).flat();
    const opened = reviews.filter((row) => row.createdAt >= start && row.createdAt < end);
    const closed = reviews.filter((row) => row.status === "resolved" && row.resolvedAt !== undefined && row.resolvedAt >= start && row.resolvedAt < end);
    const turnaroundHours = closed.map((row) => (row.resolvedAt! - row.createdAt) / 3_600_000);
    const lateClosed = closed.filter((row) => row.dueAt !== undefined && row.resolvedAt! > row.dueAt).length;
    const openAtEnd = reviews.filter((row) => row.createdAt < end && (row.status !== "resolved" || (row.resolvedAt ?? 0) >= end));
    const overdueAtEnd = openAtEnd.filter((row) => row.dueAt !== undefined && row.dueAt < end).length;

    const deciders = new Map<string, { approved: number; rejected: number }>();
    for (const row of closed) {
      if (!row.resolvedBy) continue;
      const key = row.decisionSource === "deeptrack" ? "deeptrack" : row.resolvedBy;
      const entry = deciders.get(key) ?? { approved: 0, rejected: 0 };
      if (row.resolutionAction === "confirm") entry.approved += 1;
      else if (row.resolutionAction === "keep_verdict") entry.rejected += 1;
      deciders.set(key, entry);
    }
    const names = await profileNames(ctx, [...deciders.keys()].filter((key) => key !== "deeptrack"));
    const reasons = new Map<string, number>();
    for (const row of closed) if (row.reasonCode) reasons.set(row.reasonCode, (reasons.get(row.reasonCode) ?? 0) + 1);

    // STRs (counts only: the register itself is for Admins and Reviewers).
    const strs = await ctx.db
      .query("strReports")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(1000);
    const strPrepared = strs.filter((row) => row.createdAt >= start && row.createdAt < end).length;
    const strSubmitted = strs.filter((row) => row.submittedAt !== undefined && row.submittedAt >= start && row.submittedAt < end).length;

    const monitored = await ctx.db
      .query("amlMonitoredSubjects")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "active"))
      .take(10000);

    const profile = settings.profile;
    return {
      month: args.month,
      period: { start, end },
      generatedAt: Date.now(),
      truncated,
      organization: {
        name: profile.legalName ?? client.name,
        registrationNumber: profile.registrationNumber ?? null,
        regulator: profile.regulator ? (profile.regulator === "other" ? profile.regulatorOther ?? null : REGULATOR_LABELS[profile.regulator]) : null,
        licenceNumber: profile.licenceNumber ?? null,
        complianceContact: profile.complianceContactName ?? null,
        logoUrl: profile.logoStorageId ? await ctx.storage.getUrl(profile.logoStorageId) : null,
      },
      checks: {
        total: checks.length,
        byProduct: [...byProduct.entries()].map(([product, counts]) => ({ product, label: QUEUE_LABELS[product], ...counts })),
      },
      aml: {
        screenings: amlScreenings,
        monitoringAlerts,
        monitoredSubjects: monitored.length,
        hits: RISK_CATEGORIES.map((category) => ({ category, label: RISK_CATEGORY_LABELS[category], screenings: amlHits[category] })),
        pepClasses,
      },
      reviews: {
        opened: opened.length,
        closed: closed.length,
        approved: closed.filter((row) => row.resolutionAction === "confirm").length,
        rejected: closed.filter((row) => row.resolutionAction === "keep_verdict").length,
        byTeam: closed.filter((row) => row.decisionSource !== "deeptrack").length,
        byDeepTrack: closed.filter((row) => row.decisionSource === "deeptrack").length,
        fourEyes: closed.filter((row) => row.approvedBy).length,
        medianHours: percentile(turnaroundHours, 50),
        p90Hours: percentile(turnaroundHours, 90),
        lateClosed,
        openAtEnd: openAtEnd.length,
        overdueAtEnd,
        deciders: [...deciders.entries()]
          .map(([key, counts]) => ({ name: key === "deeptrack" ? "DeepTrack reviewers" : names.get(key) ?? "Team member", ...counts }))
          .sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected)),
        reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      },
      strs: { prepared: strPrepared, submitted: strSubmitted },
    };
  },
});
