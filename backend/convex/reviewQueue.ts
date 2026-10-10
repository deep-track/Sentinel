import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireInternalUser, requireClientRole } from "./lib/rbac";
import { chargeVerification } from "./lib/credits";
import { verificationTypeLabel } from "./lib/verificationTypes";
import { recordAudit } from "./auditLog";

// ─────────────────────────────────────────────────────────
// Section 11.2 (engineering doc) — authoritative per Brian's directive
// that the engineering doc wins where it conflicts with the Platform
// Spec. Review Queue is an Internal Ops module (Section 12.2):
// resolved by internal reviewers, cross-client visibility, not a
// client-facing action.
// ─────────────────────────────────────────────────────────

const SORT_WEIGHT: Record<string, number> = {
  client_dispute: 0,
  auto_escalation: 1,
  internal_flag: 2,
};

// Upper bound on rows returned by the list queries. The internal queue is
// read oldest-first per status, so the cap drops the newest items first.
const MAX_QUEUE_ROWS = 500;

const MIN_CERTAINTY_PCT = 80;

function sortQueue<T extends { triggerType: string; createdAt: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const weightDiff = SORT_WEIGHT[a.triggerType] - SORT_WEIGHT[b.triggerType];
    if (weightDiff !== 0) return weightDiff;
    return a.createdAt - b.createdAt;
  });
}

// Internal Ops — Global Review Queue, sorted per Section 11.2: client
// disputes first, then auto-escalated, then internal flags.
export const listForInternalOps = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("in_review"), v.literal("resolved")),
    ),
  },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const status = args.status;
    const rows = status
      ? await ctx.db
          .query("reviewQueue")
          .withIndex("by_status_and_created_at", (q) => q.eq("status", status))
          .take(MAX_QUEUE_ROWS)
      : await ctx.db
          .query("reviewQueue")
          .withIndex("by_created_at")
          .order("desc")
          .take(MAX_QUEUE_ROWS);

    return sortQueue(rows);
  },
});

// Client portal — read-only view of a client's own queue. Section
// 12.1 lists this under the client portal too (they can see their
// verifications are under review), even though resolution is
// internal-only.
export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst"]);
    const rows = await ctx.db
      .query("reviewQueue")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(MAX_QUEUE_ROWS);

    return sortQueue(rows);
  },
});

export type ReviewAction = "confirm" | "keep_verdict" | "escalate";

// Training label for a resolved item, based on what the automation said vs.
// what the reviewer decided. Only corrections are recorded as labels.
function feedbackLabelFor(
  automatedVerdict: Doc<"verifications">["verdict"],
  finalVerdict: "pass" | "reject",
): "false_accept" | "false_reject" | null {
  if (finalVerdict === "reject" && automatedVerdict === "pass") return "false_accept";
  if (finalVerdict === "pass" && (automatedVerdict === "review" || automatedVerdict === "reject")) {
    return "false_reject";
  }
  return null;
}

// Shared resolution logic behind reviewQueue.resolve (the only manual-decision path).
//
// Section 11.2's three-action resolution: Confirm / Keep verdict / Escalate.
// confirm = the automated flag was WRONG (outcome pass); keep_verdict = the
// flag was RIGHT (outcome reject); escalate = insufficient evidence, routed
// to an engineer, stays open.
export async function resolveReviewItem(
  ctx: MutationCtx,
  params: {
    reviewerId: string;
    reviewRow: Doc<"reviewQueue">;
    action: ReviewAction;
    notes?: string;
    certaintyPct?: number;
  },
): Promise<{ status: "escalated" } | { status: "resolved"; verdict: "pass" | "reject" }> {
  const { reviewerId, reviewRow, action } = params;
  const notes = params.notes?.trim() || undefined;

  if (reviewRow.status === "resolved") {
    throw new ConvexError({ code: "already_resolved", message: "This item was already resolved." });
  }

  // "Keep verdict" and "Escalate" require notes for the audit trail
  // (carried over from the Platform Spec's Reject/Escalate rule,
  // applied to this taxonomy's negative/uncertain outcomes).
  if ((action === "keep_verdict" || action === "escalate") && !notes) {
    throw new ConvexError({
      code: "notes_required",
      message: `${action} requires notes for the audit trail.`,
    });
  }

  // Section 10.4 — reviewers must never confirm/keep-verdict below 80%
  // certainty; escalate instead.
  if (
    (action === "confirm" || action === "keep_verdict") &&
    (params.certaintyPct === undefined ||
      !Number.isFinite(params.certaintyPct) ||
      params.certaintyPct < MIN_CERTAINTY_PCT ||
      params.certaintyPct > 100)
  ) {
    throw new ConvexError({
      code: "certainty_too_low",
      message: "Certainty below 80% cannot be used to confirm or keep a verdict — escalate instead.",
    });
  }

  const verification = await ctx.db.get(reviewRow.verificationId);
  if (!verification) {
    throw new ConvexError({ code: "not_found", message: "Underlying verification not found." });
  }

  if (action === "escalate") {
    // Still open: no resolvedBy/resolvedAt until someone actually resolves it.
    await ctx.db.patch(reviewRow._id, {
      status: "in_review",
      escalated: true,
      resolutionNotes: notes,
    });
    await recordAudit(ctx, {
      actorId: reviewerId,
      actorType: "reviewer",
      action: "review.escalate",
      targetType: "verification",
      targetId: verification._id,
      clientId: verification.clientId,
      metadata: { reviewId: reviewRow._id, notes },
    });
    return { status: "escalated" };
  }

  // confirm -> automated flag was wrong -> final verdict "pass"
  // keep_verdict -> automated flag was right -> final verdict "reject"
  const finalVerdict = action === "confirm" ? "pass" : "reject";
  const now = Date.now();

  await ctx.db.patch(verification._id, {
    verdict: finalVerdict,
    updatedAt: now,
  });
  await ctx.db.patch(reviewRow._id, {
    status: "resolved",
    resolutionAction: action,
    resolutionNotes: notes,
    resolvedBy: reviewerId,
    resolvedAt: now,
  });

  // Idempotent per verification: a flow that already charged (e.g. AML on
  // completion) is not billed again here.
  await chargeVerification(ctx, {
    clientId: verification.clientId,
    verificationId: verification._id,
    amount: verification.creditsUsed,
    reason: `${verificationTypeLabel(verification.type)} ${finalVerdict} (resolved via manual review — ${action})`,
  });

  await recordAudit(ctx, {
    actorId: reviewerId,
    actorType: "reviewer",
    action: `review.${action}`,
    targetType: "verification",
    targetId: verification._id,
    clientId: verification.clientId,
    metadata: {
      reviewId: reviewRow._id,
      notes,
      certaintyPct: params.certaintyPct,
      previousVerdict: verification.verdict ?? null,
      finalVerdict,
    },
  });

  // Section 11.2: "Confirmed labels enter the dataset pipeline" — only
  // corrections (the automation got it wrong) are a retraining signal.
  const label = feedbackLabelFor(verification.verdict, finalVerdict);
  if (label) {
    await ctx.db.insert("feedbackLabels", {
      verificationId: verification._id,
      label,
      labeledBy: reviewerId,
      certaintyPct: params.certaintyPct!,
      notes,
      createdAt: now,
    });
  }

  await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
    verificationId: verification._id,
  });

  return { status: "resolved", verdict: finalVerdict };
}

export const resolve = mutation({
  args: {
    reviewId: v.id("reviewQueue"),
    action: v.union(
      v.literal("confirm"),
      v.literal("keep_verdict"),
      v.literal("escalate"),
    ),
    notes: v.optional(v.string()),
    // Section 10.4 — reviewers must never confirm/keep-verdict below
    // 80% certainty; escalate instead.
    certaintyPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const reviewerId = await requireInternalUser(ctx);

    const reviewRow = await ctx.db.get(args.reviewId);
    if (!reviewRow) {
      throw new ConvexError({ code: "not_found", message: "Review queue item not found." });
    }

    return await resolveReviewItem(ctx, {
      reviewerId,
      reviewRow,
      action: args.action,
      notes: args.notes,
      certaintyPct: args.certaintyPct,
    });
  },
});
