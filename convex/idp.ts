import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { orchestrateIdpVerification } from "./lib/riskEngine";

const IDP_CREDIT_COST = 1; // adjust per pricing model — not specified in the doc yet

export const processIdpVerification = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    livenessFramesBase64: v.string(),
    livenessMediaType: v.union(v.literal("jpeg_frames"), v.literal("mp4")),
    documentFrontBase64: v.string(),
    documentBackBase64: v.optional(v.string()),
    idNumber: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    dateOfBirth: v.string(),
    gender: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.verifications._markProcessing, {
      id: args.verificationId,
    });

    // NOTE: riskEngine.ts already catches provider-level failures
    // (liveness/doc-scan/IPRS/AML being down) internally and turns
    // them into a "review" verdict per Section 8.3's "never auto-
    // reject on an infrastructure problem" rule — those never reach
    // this catch block. This one is for genuinely unexpected errors
    // (a bug in this code, a malformed args shape, etc.) that would
    // otherwise crash the action silently and leave the verification
    // stuck at "processing" forever with no webhook ever firing.
    try {
      await runOrchestration(ctx, args);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.verifications._fail, {
        id: args.verificationId,
        reason,
      });
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
        verificationId: args.verificationId,
      });
    }
  },
});

async function runOrchestration(
  ctx: any,
  args: {
    verificationId: any;
    clientId: any;
    livenessFramesBase64: string;
    livenessMediaType: "jpeg_frames" | "mp4";
    documentFrontBase64: string;
    documentBackBase64?: string;
    idNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
  },
) {
    const result = await orchestrateIdpVerification({
      liveness: {
        frames: args.livenessFramesBase64,
        mediaType: args.livenessMediaType,
      },
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

    if (result.verdict === "review") {
      await ctx.runMutation(internal.verifications._completeWithReview, {
        id: args.verificationId,
        clientId: args.clientId,
        result: result.stepResults,
        triggerType: result.reviewTrigger?.triggerType ?? "auto_escalation",
        triggerReason: result.reviewTrigger?.triggerReason ?? result.reason,
        priority: "normal",
      });
      // No credit deduction — verification isn't complete yet, a human
      // still has to resolve it. Deduct on final Confirm/Keep-verdict
      // in reviewQueue.ts instead, not here.

      // Webhook still fires — Section 3.2 step 5 fires the webhook once
      // the verifications row is updated, and a "review" verdict is a
      // stable, completed status (status: "completed", verdict:
      // "review") even though it's not billed yet. The client gets
      // notified their submission needs manual review rather than
      // being left to poll indefinitely.
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
        verificationId: args.verificationId,
      });
      return;
    }

    // pass or reject both count as a completed, billable verification.
    await ctx.runMutation(internal.verifications._complete, {
      id: args.verificationId,
      verdict: result.verdict,
      confidence: result.verdict === "pass" ? 1 : 0, // TODO: derive a real confidence score once model outputs are richer than pass/review/reject
      result: result.stepResults,
    });

    await ctx.runMutation(internal.creditLedger._insertLedgerEntry, {
      clientId: args.clientId,
      verificationId: args.verificationId,
      type: "deduction",
      amount: -IDP_CREDIT_COST,
      reason: `IDP verification ${result.verdict}`,
    });

    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
      verificationId: args.verificationId,
    });
}