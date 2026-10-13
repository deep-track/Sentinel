import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";
import { withoutMedia } from "./verifications";

// Everything the client-facing AML screening report needs for one
// screening (app/(platform)/aml-check/[id]): the verification with its full
// result, the review item and its outcome, the monitored subject (if this
// screening enrolled it or is one of its alerts) and the client's name.
// Any member of the client can read it, like the screening itself.

const REPORT_ROLES = ["client_admin", "compliance_analyst", "developer", "viewer"] as const;

export const forClient = query({
  // A plain string, so a mistyped link shows "not found" instead of an error.
  args: { verificationId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("verifications", args.verificationId);
    const verification = id ? await ctx.db.get(id) : null;
    if (!verification || verification.type !== "aml") return null;
    try {
      await requireClientRole(ctx, verification.clientId, [...REPORT_ROLES]);
    } catch {
      return null;
    }
    const client = await ctx.db.get(verification.clientId);

    const review = await ctx.db
      .query("reviewQueue")
      .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
      .order("desc")
      .first();

    const monitoringReference = (verification.input as { monitoring?: { subject?: unknown } } | null)?.monitoring?.subject;
    const subject =
      (await ctx.db
        .query("amlMonitoredSubjects")
        .withIndex("by_enrolled_verification", (q) => q.eq("enrolledVerificationId", verification._id))
        .first()) ??
      (typeof monitoringReference === "string"
        ? await ctx.db
            .query("amlMonitoredSubjects")
            .withIndex("by_reference", (q) => q.eq("reference", monitoringReference))
            .unique()
        : null);

    return {
      verification: withoutMedia(verification),
      clientName: client?.name ?? null,
      review: review
        ? {
            status: review.status,
            priority: review.priority,
            triggerType: review.triggerType,
            triggerReason: review.triggerReason,
            createdAt: review.createdAt,
            resolutionAction: review.resolutionAction ?? null,
            resolutionNotes: review.resolutionNotes ?? null,
            resolvedAt: review.resolvedAt ?? null,
            resolvedByName: review.resolvedByName ?? null,
          }
        : null,
      monitoring:
        subject && subject.clientId === verification.clientId
          ? {
              reference: subject.reference,
              status: subject.status,
              externalRef: subject.externalRef ?? null,
              enrolledHere: subject.enrolledVerificationId === verification._id,
              lastScreenedAt: subject.lastScreenedAt ?? null,
              nextScreenAt: subject.status === "active" ? subject.nextScreenAt : null,
              alertCount: subject.alertCount,
              currentHits: subject.hits.length,
            }
          : null,
    };
  },
});
