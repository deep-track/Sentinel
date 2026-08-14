import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  buildWebhookPayload,
  deliverWebhook,
  WEBHOOK_RETRY_SCHEDULE_MS,
  MAX_WEBHOOK_ATTEMPTS,
} from "./lib/webhookDispatch";

export const dispatchWebhook = internalAction({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.runQuery(internal.verifications._getById, {
      id: args.verificationId,
    });
    if (!verification) return;

    const client = await ctx.runQuery(internal.webhooks._getClientForWebhook, {
      clientId: verification.clientId,
    });
    if (!client?.webhookUrl || !client.webhookSecret) {
      return; // no webhook registered — nothing to do
    }

    const deliveryId: any = await ctx.runMutation(internal.webhooks._createDelivery, {
      clientId: verification.clientId,
      verificationId: args.verificationId,
      payload: buildWebhookPayload({
        reference: verification.reference,
        verdict: verification.verdict ?? "review",
        result: verification.result,
      }),
    });

    await ctx.runAction(internal.webhooks.attemptDelivery, { deliveryId });
  },
});

export const attemptDelivery = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(internal.webhooks._getDelivery, {
      deliveryId: args.deliveryId,
    });
    if (!delivery || delivery.status === "delivered") return;

    const client = await ctx.runQuery(internal.webhooks._getClientForWebhook, {
      clientId: delivery.clientId,
    });
    if (!client?.webhookUrl || !client.webhookSecret) {
      await ctx.runMutation(internal.webhooks._markFailed, { deliveryId: args.deliveryId });
      return;
    }

    const result = await deliverWebhook(
      client.webhookUrl,
      delivery.payload,
      client.webhookSecret,
    );

    if (result.success) {
      await ctx.runMutation(internal.webhooks._markDelivered, {
        deliveryId: args.deliveryId,
        responseStatus: result.statusCode ?? 200,
      });
      return;
    }

    const nextAttemptCount = delivery.attemptCount + 1;
    if (nextAttemptCount >= MAX_WEBHOOK_ATTEMPTS) {
      await ctx.runMutation(internal.webhooks._markFailed, {
        deliveryId: args.deliveryId,
        responseStatus: result.statusCode,
      });
      return;
    }

    const delayMs = WEBHOOK_RETRY_SCHEDULE_MS[delivery.attemptCount];
    const nextRetryAt = Date.now() + delayMs;

    await ctx.runMutation(internal.webhooks._markRetrying, {
      deliveryId: args.deliveryId,
      responseStatus: result.statusCode,
      nextRetryAt,
    });

    await ctx.scheduler.runAt(nextRetryAt, internal.webhooks.attemptDelivery, {
      deliveryId: args.deliveryId,
    });
  },
});

export const resendWebhook = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
    }
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) {
      throw new ConvexError({ code: "not_found", message: "Delivery not found." });
    }
    await ctx.db.patch(args.deliveryId, {
      status: "pending",
      attemptCount: 0,
      nextRetryAt: undefined,
    });
    // Fire immediately — internalAction, called via scheduler since
    // mutations can't call actions directly.
    await ctx.scheduler.runAfter(0, internal.webhooks.attemptDelivery, {
      deliveryId: args.deliveryId,
    });
  },
});


export const _getClientForWebhook = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
    return { webhookUrl: client.webhookUrl, webhookSecret: client.webhookSecret };
  },
});

export const _createDelivery = internalMutation({
  args: {
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("webhookDeliveries", {
      clientId: args.clientId,
      verificationId: args.verificationId,
      status: "pending",
      attemptCount: 0,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const _getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => await ctx.db.get(args.deliveryId),
});

export const _markDelivered = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), responseStatus: v.number() },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    await ctx.db.patch(args.deliveryId, {
      status: "delivered",
      attemptCount: (delivery?.attemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      lastResponseStatus: args.responseStatus,
    });
  },
});

export const _markRetrying = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    responseStatus: v.optional(v.number()),
    nextRetryAt: v.number(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    await ctx.db.patch(args.deliveryId, {
      status: "retrying",
      attemptCount: (delivery?.attemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      lastResponseStatus: args.responseStatus,
      nextRetryAt: args.nextRetryAt,
    });
  },
});

export const _markFailed = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), responseStatus: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    await ctx.db.patch(args.deliveryId, {
      status: "failed",
      attemptCount: (delivery?.attemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      lastResponseStatus: args.responseStatus,
      nextRetryAt: undefined,
    });
  },
});