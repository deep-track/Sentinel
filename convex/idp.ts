import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { orchestrateIdpVerification } from "./lib/riskEngine";

const IDP_CREDIT_COST = 1; 

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
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
        verificationId: args.verificationId,
      });
      return;
    }

    // pass or reject both count as completed
    await ctx.runMutation(internal.verifications._complete, {
      id: args.verificationId,
      verdict: result.verdict,
      confidence: result.verdict === "pass" ? 1 : 0, 
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
  },
});