import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recordAudit } from "./auditLog";
import { displayName } from "./reviewQueue";
import { isInternalAdmin, requireInternalUser } from "./lib/rbac";
import { profileNames } from "./userProfiles";

// Sentinel Back Office: review operations. Workload and turnaround per
// reviewer against a deadline per priority, assignment, how often reviewers
// overturn the automated verdict, and why items are held.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ROWS = 5_000;
const MAX_OVERTURN_ROWS = 1_000;

// Time to resolve, by priority. Proposed defaults; shown on the page.
export const DEADLINE_HOURS: Record<Doc<"reviewQueue">["priority"], number> = { high: 4, normal: 24, low: 72 };

export function isOverdue(item: Pick<Doc<"reviewQueue">, "priority" | "createdAt" | "resolvedAt">, now: number): boolean {
  const end = item.resolvedAt ?? now;
  return end - item.createdAt > DEADLINE_HOURS[item.priority] * HOUR_MS;
}

export type HoldReason =
  | "Client dispute"
  | "Service outage"
  | "Liveness not collected"
  | "Liveness or face check"
  | "Document authenticity"
  | "Identity registry (IPRS)"
  | "Sanctions match"
  | "PEP / risk list"
  | "Other";

// Groups a review item's trigger into a small set of causes.
export function holdReason(item: Pick<Doc<"reviewQueue">, "triggerType" | "triggerReason">): HoldReason {
  if (item.triggerType === "client_dispute") return "Client dispute";
  const reason = item.triggerReason.toLowerCase();
  if (/infrastructure failure|unavailable|timeout|timed out|not configured|stale/.test(reason)) return "Service outage";
  if (reason.includes("liveness not collected") || reason.includes("liveness was not collected")) return "Liveness not collected";
  if (/liveness|deepfake|selfie|face check|live person/.test(reason)) return "Liveness or face check";
  if (reason.includes("document")) return "Document authenticity";
  if (reason.includes("iprs")) return "Identity registry (IPRS)";
  // PEP first, and "sanction" as a whole word only: "OpenSanctions PEP match"
  // is a PEP hold, not a sanctions one.
  if (/\bpep\b|politically exposed|risk-list|risk list|special interest|fitness and probity|insolvency|adverse media/.test(reason)) {
    return "PEP / risk list";
  }
  if (/\bsanctions?\b|watchlist|ofac|terror/.test(reason)) return "Sanctions match";
  return "Other";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const reviewOperations = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const viewerId = await requireInternalUser(ctx);
    const since30 = args.now - 30 * DAY_MS;
    const since90 = args.now - 90 * DAY_MS;

    const open = (
      await Promise.all(
        (["pending", "in_review"] as const).map((status) =>
          ctx.db.query("reviewQueue").withIndex("by_status_and_created_at", (q) => q.eq("status", status)).take(MAX_ROWS),
        ),
      )
    ).flat();
    const recent = await ctx.db.query("reviewQueue").withIndex("by_created_at", (q) => q.gte("createdAt", since90)).take(MAX_ROWS);
    const resolved30 = recent.filter((item) => item.status === "resolved" && (item.resolvedAt ?? 0) >= since30);

    // Names: the newest name seen for each user id.
    const names = new Map<string, string>();
    for (const item of [...recent, ...open].sort((a, b) => a.createdAt - b.createdAt)) {
      if (item.assignedTo && item.assignedToName) names.set(item.assignedTo, item.assignedToName);
      if (item.resolvedBy && item.resolvedByName) names.set(item.resolvedBy, item.resolvedByName);
    }
    // A user's own profile (userProfiles) wins over the name stored on the item.
    const profiles = await profileNames(
      ctx,
      [...recent, ...open].flatMap((item) => [item.assignedTo, item.resolvedBy].filter((id): id is string => Boolean(id))),
    );
    const nameOf = (id: string) => profiles.get(id) ?? names.get(id) ?? id;

    // Workload per reviewer.
    const reviewers = new Map<string, { open: number; overdue: number; resolved30: number; resolveMs: number[] }>();
    const entry = (id: string) => {
      const existing = reviewers.get(id) ?? { open: 0, overdue: 0, resolved30: 0, resolveMs: [] };
      reviewers.set(id, existing);
      return existing;
    };
    for (const item of open) {
      if (!item.assignedTo) continue;
      const row = entry(item.assignedTo);
      row.open += 1;
      if (isOverdue(item, args.now)) row.overdue += 1;
    }
    for (const item of resolved30) {
      if (!item.resolvedBy) continue;
      const row = entry(item.resolvedBy);
      row.resolved30 += 1;
      if (item.resolvedAt) row.resolveMs.push(item.resolvedAt - item.createdAt);
    }

    // Turnaround against the deadline, last 30 days.
    const byPriority = (["high", "normal", "low"] as const).map((priority) => {
      const done = resolved30.filter((item) => item.priority === priority);
      return {
        priority,
        deadlineHours: DEADLINE_HOURS[priority],
        resolved: done.length,
        withinDeadline: done.filter((item) => !isOverdue(item, args.now)).length,
        medianMs: median(done.filter((item) => item.resolvedAt).map((item) => item.resolvedAt! - item.createdAt)),
        openOverdue: open.filter((item) => item.priority === priority && isOverdue(item, args.now)).length,
      };
    });

    // Why items are held: open now and opened in the last 30 days.
    const reasonCounts = new Map<HoldReason, { open: number; last30: number }>();
    for (const item of open) {
      const reason = holdReason(item);
      const row = reasonCounts.get(reason) ?? { open: 0, last30: 0 };
      row.open += 1;
      reasonCounts.set(reason, row);
    }
    for (const item of recent.filter((row) => row.createdAt >= since30)) {
      const reason = holdReason(item);
      const row = reasonCounts.get(reason) ?? { open: 0, last30: 0 };
      row.last30 += 1;
      reasonCounts.set(reason, row);
    }

    // Overturn rate: resolved (confirm / keep verdict) in 90 days that a
    // reviewer corrected, by verification type.
    const decided = recent
      .filter((item) => item.status === "resolved" && (item.resolutionAction === "confirm" || item.resolutionAction === "keep_verdict"))
      .slice(0, MAX_OVERTURN_ROWS);
    const overturns = new Map<string, { decided: number; overturned: number; falseReject: number; falseAccept: number }>();
    for (const item of decided) {
      const verification = await ctx.db.get(item.verificationId);
      const type = verification?.type ?? "unknown";
      const row = overturns.get(type) ?? { decided: 0, overturned: 0, falseReject: 0, falseAccept: 0 };
      row.decided += 1;
      const label = await ctx.db.query("feedbackLabels").withIndex("by_verification", (q) => q.eq("verificationId", item.verificationId)).first();
      if (label?.label === "false_reject") {
        row.overturned += 1;
        row.falseReject += 1;
      } else if (label?.label === "false_accept") {
        row.overturned += 1;
        row.falseAccept += 1;
      }
      overturns.set(type, row);
    }

    // Open items for assignment, oldest overdue first.
    const clientIds = [...new Set(open.map((item) => item.clientId))];
    const clientNames = new Map(
      (await Promise.all(clientIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((client) => [client!._id, client!.name]),
    );
    const openItems = await Promise.all(
      [...open]
        .sort((a, b) => Number(isOverdue(b, args.now)) - Number(isOverdue(a, args.now)) || a.createdAt - b.createdAt)
        .slice(0, 100)
        .map(async (item) => {
          const verification = await ctx.db.get(item.verificationId);
          return {
            _id: item._id,
            clientName: clientNames.get(item.clientId) ?? "Unknown client",
            type: verification?.type ?? null,
            reference: verification?.reference ?? null,
            priority: item.priority,
            reason: holdReason(item),
            createdAt: item.createdAt,
            overdue: isOverdue(item, args.now),
            dueAt: item.createdAt + DEADLINE_HOURS[item.priority] * HOUR_MS,
            assignedTo: item.assignedTo ?? null,
            assignedToName: item.assignedTo ? nameOf(item.assignedTo) : null,
          };
        }),
    );

    return {
      viewerId,
      viewerIsAdmin: await isInternalAdmin(ctx),
      deadlineHours: DEADLINE_HOURS,
      openCount: open.length,
      unassignedCount: open.filter((item) => !item.assignedTo).length,
      overdueCount: open.filter((item) => isOverdue(item, args.now)).length,
      byPriority,
      reviewers: [...reviewers.entries()]
        .map(([id, row]) => ({ id, name: nameOf(id), open: row.open, overdue: row.overdue, resolved30: row.resolved30, medianResolveMs: median(row.resolveMs) }))
        .sort((a, b) => b.open - a.open || b.resolved30 - a.resolved30),
      holdReasons: [...reasonCounts.entries()].map(([reason, row]) => ({ reason, ...row })).sort((a, b) => b.last30 - a.last30),
      overturns: [...overturns.entries()].map(([type, row]) => ({ type, ...row })).sort((a, b) => b.decided - a.decided),
      openItems,
      truncated: recent.length === MAX_ROWS,
    };
  },
});

// Assign an open item: anyone with an internal role (not view-only) can take
// it or release their own; only internal admins can assign to or take from
// someone else.
export const assignReviewItem = mutation({
  args: {
    reviewId: v.id("reviewQueue"),
    to: v.union(v.literal("me"), v.literal("nobody"), v.object({ userId: v.string(), name: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalUser(ctx, "write");
    const admin = await isInternalAdmin(ctx);
    const item = await ctx.db.get(args.reviewId);
    if (!item) throw new ConvexError({ code: "not_found", message: "Review item not found." });
    if (item.status === "resolved") throw new ConvexError({ code: "invalid_state", message: "This item is already resolved." });

    const ownsOrFree = !item.assignedTo || item.assignedTo === actorId;
    if (!admin && (!ownsOrFree || typeof args.to === "object")) {
      throw new ConvexError({ code: "forbidden", message: "Only an administrator can reassign another reviewer's item." });
    }

    const actorName = displayName(await ctx.auth.getUserIdentity());
    const next =
      args.to === "me"
        ? { assignedTo: actorId, assignedToName: actorName, assignedAt: Date.now() }
        : args.to === "nobody"
          ? { assignedTo: undefined, assignedToName: undefined, assignedAt: undefined }
          : { assignedTo: args.to.userId, assignedToName: args.to.name?.slice(0, 120), assignedAt: Date.now() };
    await ctx.db.patch(args.reviewId, next);
    await recordAudit(ctx, {
      actorId,
      actorType: admin ? "internal_admin" : "reviewer",
      action: "review.assigned",
      targetType: "reviewQueue",
      targetId: args.reviewId,
      clientId: item.clientId,
      metadata: { from: item.assignedTo ?? null, to: next.assignedTo ?? null },
    });
  },
});
