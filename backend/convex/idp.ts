import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { orchestrateIdpVerification } from "./lib/riskEngine";

// Risk policy: without a liveness capture nothing proves the presenter is the
// person on the document, so an otherwise clean result is held for manual
// review instead of auto-passing. Reject outcomes are unaffected.
const REQUIRE_LIVENESS_FOR_AUTO_PASS = true;

const GENERIC_FAILURE_REASON = "Verification processing failed. Please retry or contact support.";

const processArgs = {
  verificationId: v.id("verifications"),
  clientId: v.id("clients"),
  livenessFramesBase64: v.optional(v.string()),
  livenessMediaType: v.optional(v.union(v.literal("jpeg_frames"), v.literal("mp4"))),
  documentFrontBase64: v.string(),
  documentBackBase64: v.optional(v.string()),
  idNumber: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  dateOfBirth: v.string(),
  gender: v.string(),
};

type ProcessArgs = {
  verificationId: Id<"verifications">;
  clientId: Id<"clients">;
  livenessFramesBase64?: string;
  livenessMediaType?: "jpeg_frames" | "mp4";
  documentFrontBase64: string;
  documentBackBase64?: string;
  idNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
};

export const processIdpVerification = internalAction({
  args: processArgs,
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.verifications._markProcessing, {
      id: args.verificationId,
    });

    try {
      await runOrchestration(ctx, args);
    } catch (err) {
      // Details stay in the server logs; clients get a generic reason so
      // upstream error bodies never reach the API or webhooks.
      console.error("[idp] processing failed", args.verificationId, err);
      // _fail is a no-op (and sends no webhook) if the verification already
      // completed, so a late error can't overwrite the verdict.
      await ctx.runMutation(internal.verifications._fail, {
        id: args.verificationId,
        reason: GENERIC_FAILURE_REASON,
        notifyWebhook: true,
      });
    }
  },
});

async function runOrchestration(ctx: ActionCtx, args: ProcessArgs) {
  const livenessCollected = Boolean(args.livenessFramesBase64 && args.livenessMediaType);

  const result = await orchestrateIdpVerification({
    liveness: livenessCollected
      ? { frames: args.livenessFramesBase64!, mediaType: args.livenessMediaType! }
      : undefined,
    document: {
      frontImageBase64: args.documentFrontBase64,
      backImageBase64: args.documentBackBase64,
    },
    identity: {
      idNumber: args.idNumber,
      firstName: args.firstName,
      lastName: args.lastName,
      dateOfBirth: args.dateOfBirth,
      gender: args.gender,
    },
    amlEntityName: `${args.firstName} ${args.lastName}`,
  });

  const stepResults: Record<string, unknown> = livenessCollected
    ? { ...result.stepResults }
    : { ...result.stepResults, liveness: { status: "not_collected" } };

  let verdict = result.verdict;
  let reviewTrigger = result.reviewTrigger;
  let reason = result.reason;
  if (verdict === "pass" && !livenessCollected && REQUIRE_LIVENESS_FOR_AUTO_PASS) {
    verdict = "review";
    reason = "Liveness was not collected — held for manual review.";
    reviewTrigger = {
      triggerType: "auto_escalation",
      triggerReason: "Liveness not collected; presenter not verified against the document.",
    };
  }

  if (verdict === "review") {
    // No credit deduction yet: charged on the final Confirm/Keep-verdict.
    await ctx.runMutation(internal.verifications._completeWithReview, {
      id: args.verificationId,
      clientId: args.clientId,
      result: stepResults,
      triggerType: reviewTrigger?.triggerType ?? "auto_escalation",
      triggerReason: reviewTrigger?.triggerReason ?? reason,
      priority: "normal",
      notifyWebhook: true,
    });
    return;
  }

  // pass or reject both count as a completed, billable verification. The
  // verdict, the (idempotent) charge and the webhook commit together.
  await ctx.runMutation(internal.verifications._complete, {
    id: args.verificationId,
    verdict,
    confidence: verdict === "pass" ? 1 : 0,
    result: stepResults,
    chargeReason: `IDP verification ${verdict}`,
    notifyWebhook: true,
  });
}
