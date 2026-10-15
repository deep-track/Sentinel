import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole, type ClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { queueReview, subjectOf, reportHref } from "./clientReviews";
import { MAX_OPEN_DISPUTES, disputeBlocker, cleanDisputeReason } from "./lib/disputes";

// Client disputes: a client team challenges an automated result (a pass it
// believes should have failed, or a rejection it believes is wrong).
// The dispute opens a high-priority case that DeepTrack decides in the
// Back Office review queue (client teams can't decide it themselves, see
// clientReviews.loadOpen). The original result stands until then; the
// decision changes the verdict or keeps it, notifies the team
// ("dispute_resolved") and sends the usual webhook.

const DISPUTE_ROLES: ClientRole[] = ["client_admin", "reviewer", "compliance_analyst"];
const READ_ROLES: ClientRole[] = ["client_admin", "reviewer", "compliance_analyst", "viewer"];
const MAX_LISTED = 200;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

async function openDisputeCount(ctx: { db: any }, clientId: Id<"clients">): Promise<number> {
  let count = 0;
  for (const status of ["pending", "in_review"] as const) {
    const rows: Array<Doc<"reviewQueue">> = await ctx.db
      .query("reviewQueue")
      .withIndex("by_client_and_status", (q: any) => q.eq("clientId", clientId).eq("status", status))
      .take(1000);
    count += rows.filter((row) => row.triggerType === "client_dispute").length;
  }
  return count;
}

// Whether a result can be disputed, and why not (for the button).
export const eligibility = query({
  args: { verificationId: v.string() },
  handler: async (ctx, args) => {
    const verificationId = ctx.db.normalizeId("verifications", args.verificationId);
    const verification = verificationId ? await ctx.db.get(verificationId) : null;
    if (!verification) return null;
    const actor = await requireClientRole(ctx, verification.clientId, READ_ROLES);
    const reviews = await ctx.db
      .query("reviewQueue")
      .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
      .take(50);
    const openDispute = reviews.find((row) => row.triggerType === "client_dispute" && row.status !== "resolved") ?? null;
    const blocker = disputeBlocker({ verification, reviews, now: Date.now() });
    const allowedRole = actor.role === "internal_admin" || DISPUTE_ROLES.includes(actor.role);
    return {
      canDispute: !blocker && allowedRole,
      reason: blocker ?? (allowedRole ? null : "Your role can't dispute results."),
      openDisputeId: openDispute?._id ?? null,
      disputedAt: verification.disputedAt ?? null,
      disputeReason: verification.disputeReason ?? null,
      verdict: verification.verdict ?? null,
    };
  },
});

export const open = mutation({
  args: {
    verificationId: v.id("verifications"),
    reason: v.string(),
    // What the team believes the result should be.
    expectedVerdict: v.union(v.literal("pass"), v.literal("reject")),
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) throw new ConvexError({ code: "not_found", message: "Check not found." });
    const actor = await requireClientRole(ctx, verification.clientId, DISPUTE_ROLES);
    const reason = cleanDisputeReason(args.reason);
    if (typeof reason !== "string") invalid(reason.error);
    const reviews = await ctx.db
      .query("reviewQueue")
      .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
      .take(50);
    const blocker = disputeBlocker({ verification, reviews, now: Date.now() });
    if (blocker) invalid(blocker);
    if (args.expectedVerdict === verification.verdict) invalid(`The result is already ${verification.verdict}.`);
    if ((await openDisputeCount(ctx, verification.clientId)) >= MAX_OPEN_DISPUTES) {
      invalid(`Your team has ${MAX_OPEN_DISPUTES} open disputes. Wait for DeepTrack to decide some first.`);
    }

    const now = Date.now();
    await ctx.db.patch(verification._id, { disputeReason: reason, disputedAt: now, updatedAt: now });
    const reviewId = await queueReview(ctx, {
      verificationId: verification._id,
      clientId: verification.clientId,
      triggerType: "client_dispute",
      triggerReason: `Client dispute (${verification.verdict} → ${args.expectedVerdict} expected): ${reason}`.slice(0, 2000),
      priority: "high",
    });
    await ctx.db.patch(reviewId, { disputedVerdict: verification.verdict === "pass" ? "pass" : "reject", expectedVerdict: args.expectedVerdict });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "verification.disputed",
      targetType: "verification",
      targetId: verification._id,
      clientId: verification.clientId,
      metadata: { reviewId, verdict: verification.verdict ?? null, expectedVerdict: args.expectedVerdict, reason },
    });
    return { reviewId };
  },
});

// The team withdraws its own dispute before DeepTrack decides it.
export const withdraw = mutation({
  args: { reviewId: v.id("reviewQueue") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reviewId);
    if (!row || row.triggerType !== "client_dispute") throw new ConvexError({ code: "not_found", message: "Dispute not found." });
    const actor = await requireClientRole(ctx, row.clientId, DISPUTE_ROLES);
    if (row.status === "resolved") invalid("This dispute is already closed.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "resolved", withdrawnAt: now, withdrawnBy: actor.userId, resolvedAt: now });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "verification.dispute_withdrawn",
      targetType: "verification",
      targetId: row.verificationId,
      clientId: row.clientId,
      metadata: { reviewId: row._id },
    });
    return null;
  },
});

// The team's disputes, open first, then decided / withdrawn.
export const list = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, READ_ROLES);
    const rows: Array<Doc<"reviewQueue">> = [];
    for (const status of ["pending", "in_review", "resolved"] as const) {
      const batch = await ctx.db
        .query("reviewQueue")
        .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", status))
        .order("desc")
        .take(status === "resolved" ? 2000 : 1000);
      rows.push(...batch.filter((row) => row.triggerType === "client_dispute"));
    }
    const listed = rows.slice(0, MAX_LISTED);
    return await Promise.all(
      listed.map(async (row) => {
        const verification = await ctx.db.get(row.verificationId);
        return {
          _id: row._id,
          status: row.withdrawnAt ? ("withdrawn" as const) : row.status === "resolved" ? ("decided" as const) : ("open" as const),
          reason: verification?.disputeReason ?? row.triggerReason,
          disputedVerdict: row.disputedVerdict ?? null,
          expectedVerdict: row.expectedVerdict ?? null,
          createdAt: row.createdAt,
          resolvedAt: row.resolvedAt ?? null,
          outcome:
            row.status === "resolved" && !row.withdrawnAt && row.resolutionAction
              ? { verdict: row.resolutionAction === "confirm" ? ("pass" as const) : ("reject" as const), notes: row.resolutionNotes ?? null, decidedBy: row.resolvedByName ?? "DeepTrack" }
              : null,
          verification: verification
            ? { _id: verification._id, reference: verification.reference, type: verification.type, verdict: verification.verdict ?? null, subject: subjectOf(verification), href: reportHref(verification) }
            : null,
        };
      }),
    );
  },
});
