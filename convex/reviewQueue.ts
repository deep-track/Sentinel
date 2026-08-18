import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireInternalUser, requireClientRole } from "./lib/rbac";

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
    const rows = args.status
      ? await ctx.db
          .query("reviewQueue")
          .filter((q) => q.eq(q.field("status"), args.status))
          .collect()
      : await ctx.db.query("reviewQueue").collect();

    return rows.sort((a, b) => {
      const weightDiff = SORT_WEIGHT[a.triggerType] - SORT_WEIGHT[b.triggerType];
      if (weightDiff !== 0) return weightDiff;
      return a.createdAt - b.createdAt;
    });
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
      .collect();

    return rows.sort((a, b) => {
      const weightDiff = SORT_WEIGHT[a.triggerType] - SORT_WEIGHT[b.triggerType];
      if (weightDiff !== 0) return weightDiff;
      return a.createdAt - b.createdAt;
    });
  },
});

// Section 11.2's three-action resolution: Confirm / Keep verdict /
// Escalate. See schema.ts's resolutionAction field for the semantics
// of each — briefly: confirm = the automated flag was WRONG (outcome
// pass, write a feedbackLabels row); keep_verdict = the flag was
// RIGHT (outcome reject, no feedback label needed); escalate =
// insufficient evidence, routed to an engineer, stays open.
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
    if (reviewRow.status === "resolved") {
      throw new ConvexError({ code: "already_resolved", message: "This item was already resolved." });
    }

    // "Keep verdict" and "Escalate" require notes for the audit trail
    // (carried over from the Platform Spec's Reject/Escalate rule,
    // applied to this taxonomy's negative/uncertain outcomes).
    if ((args.action === "keep_verdict" || args.action === "escalate") && !args.notes?.trim()) {
      throw new ConvexError({
        code: "notes_required",
        message: `${args.action} requires notes for the audit trail.`,
      });
    }

    if (
      (args.action === "confirm" || args.action === "keep_verdict") &&
      (args.certaintyPct === undefined || args.certaintyPct < 80)
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

    if (args.action === "escalate") {
      await ctx.db.patch(args.reviewId, {
        status: "in_review",
        escalated: true,
        resolutionNotes: args.notes,
        resolvedBy: reviewerId,
      });
      await ctx.runMutation(internal.auditLog._log, {
        actorId: reviewerId,
        actorType: "reviewer",
        action: "review.escalate",
        targetType: "verification",
        targetId: verification._id,
        clientId: verification.clientId,
        metadata: { notes: args.notes },
      });
      return { status: "escalated" };
    }

    // confirm -> automated flag was wrong -> final verdict "pass"
    // keep_verdict -> automated flag was right -> final verdict "reject"
    const finalVerdict = args.action === "confirm" ? "pass" : "reject";

    await ctx.db.patch(reviewRow.verificationId, {
      verdict: finalVerdict,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.reviewId, {
      status: "resolved",
      resolutionAction: args.action,
      resolutionNotes: args.notes,
      resolvedBy: reviewerId,
      resolvedAt: Date.now(),
    });

    await ctx.runMutation(internal.creditLedger._insertLedgerEntry, {
      clientId: verification.clientId,
      verificationId: reviewRow.verificationId,
      type: "deduction",
      amount: -verification.creditsUsed,
      reason: `IDP verification ${finalVerdict} (resolved via manual review — ${args.action})`,
    });

    await ctx.runMutation(internal.auditLog._log, {
      actorId: reviewerId,
      actorType: "reviewer",
      action: `review.${args.action}`,
      targetType: "verification",
      targetId: verification._id,
      clientId: verification.clientId,
      metadata: { notes: args.notes, certaintyPct: args.certaintyPct },
    });

    // Section 11.2: "Confirmed labels enter the dataset pipeline" —
    // only "confirm" produces a retraining signal, since it's the case
    // where the model got it wrong. "keep_verdict" means the model was
    // right, which isn't itself a training signal worth logging here.
    if (args.action === "confirm") {
      await ctx.db.insert("feedbackLabels", {
        verificationId: reviewRow.verificationId,
        label: "false_reject", // the auto-flag incorrectly leaned negative
        labeledBy: reviewerId,
        certaintyPct: args.certaintyPct!,
        notes: args.notes,
        createdAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
      verificationId: reviewRow.verificationId,
    });

    return { status: "resolved", verdict: finalVerdict };
  },
});