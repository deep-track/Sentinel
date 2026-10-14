import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import {
  buildWebhookPayload,
  buildFailureWebhookPayload,
  deliverWebhook,
  WEBHOOK_RETRY_SCHEDULE_MS,
  MAX_WEBHOOK_ATTEMPTS,
} from "./lib/webhookDispatch";

// Called (fire-and-forget, via scheduler) after a verification reaches
// a terminal state — completed (pass/review/reject) OR failed. Does
// nothing if the client hasn't registered a webhook URL, per Section
// 8.4's "if a webhook is registered".
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

    // Previously this only ever built a pass/review/reject payload,
    // which meant a genuine processing failure (verifications.status
    // === "failed") never notified the client at all — they'd be left
    // polling GET /v1/verify/{id} indefinitely. Now branches on status
    // first, verdict second.
    const payload =
      verification.status === "failed"
        ? buildFailureWebhookPayload({
            reference: verification.reference,
            failureReason: verification.failureReason,
          })
        : buildWebhookPayload({
            reference: verification.reference,
            verdict: verification.verdict ?? "review",
            result: verification.result,
          });
    // Events the client chose not to receive (Settings → Developers).
    if (client.webhookEvents && !client.webhookEvents.includes(payload.event)) return;

    const deliveryId: Id<"webhookDeliveries"> = await ctx.runMutation(
      internal.webhooks._createDelivery,
      {
        clientId: verification.clientId,
        verificationId: args.verificationId,
        payload,
      },
    );

    await ctx.scheduler.runAfter(0, internal.webhooks.attemptDelivery, { deliveryId });
  },
});

// One delivery attempt. Reschedules itself via the confirmed retry
// schedule (1min/5min/30min/2hr/6hr/24hr) on failure; marks the
// delivery "failed" for the client portal's manual-resend UI once
// the schedule is exhausted.
export const attemptDelivery = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(internal.webhooks._getDelivery, {
      deliveryId: args.deliveryId,
    });
    // "failed" is terminal until a manual resend flips it back to "pending".
    if (!delivery || delivery.status === "delivered" || delivery.status === "failed") return;

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
    if (result.permanent || nextAttemptCount >= MAX_WEBHOOK_ATTEMPTS) {
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

// Section 12.1 — client portal's manual "test-send"/resend action.
// Now properly client-scoped: only an active Client Admin or
// Compliance Analyst on THIS delivery's client can resend it.
export const resendWebhook = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) {
      throw new ConvexError({ code: "not_found", message: "Delivery not found." });
    }
    await requireClientRole(ctx, delivery.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer"]);
    // Only a delivery whose retry schedule is exhausted can be resent;
    // resending a pending/retrying one would start a second retry chain.
    if (delivery.status !== "failed") {
      throw new ConvexError({
        code: "invalid_state",
        message: "Only failed deliveries can be resent.",
      });
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

// ── internal plumbing ──────────────────────────────────────────

export const _getClientForWebhook = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
    return { webhookUrl: client.webhookUrl, webhookSecret: client.webhookSecret, webhookEvents: client.webhookEvents ?? null };
  },
});

// ── Portal (Settings → Developers, Webhooks page) ──────────────────────────

export const WEBHOOK_EVENTS = [
  { value: "sentinel.scan.complete", label: "Check completed or failed (every product, and review decisions)" },
  { value: "sentinel.monitoring.alert", label: "AML monitoring alert" },
] as const;
const MAX_DELIVERIES_LISTED = 50;

export const getForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(MAX_DELIVERIES_LISTED);
    const verifications = await Promise.all(deliveries.map((row) => ctx.db.get(row.verificationId)));
    return {
      webhookUrl: client.webhookUrl ?? null,
      configured: Boolean(client.webhookUrl && client.webhookSecret),
      events: client.webhookEvents ?? WEBHOOK_EVENTS.map((event) => event.value),
      eventOptions: WEBHOOK_EVENTS,
      deliveries: deliveries.map((row, index) => ({
        _id: row._id,
        status: row.status,
        event: (row.payload as { event?: string } | null)?.event ?? null,
        reference: verifications[index]?.reference ?? null,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt ?? null,
        nextRetryAt: row.nextRetryAt ?? null,
        lastResponseStatus: row.lastResponseStatus ?? null,
        createdAt: row.createdAt,
      })),
    };
  },
});

export const setEvents = mutation({
  args: { clientId: v.id("clients"), events: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "developer"]);
    const known: string[] = WEBHOOK_EVENTS.map((event) => event.value);
    const events = [...new Set(args.events)];
    if (events.length === 0) throw new ConvexError({ code: "invalid_argument", message: "Choose at least one event, or remove the webhook." });
    if (events.some((event) => !known.includes(event))) throw new ConvexError({ code: "invalid_argument", message: "Unknown webhook event." });
    const client = await ctx.db.get(args.clientId);
    await ctx.db.patch(args.clientId, { webhookEvents: events });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "webhook.events_updated",
      targetType: "webhook",
      targetId: args.clientId,
      clientId: args.clientId,
      metadata: { before: client?.webhookEvents ?? "all", after: events },
    });
    return null;
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