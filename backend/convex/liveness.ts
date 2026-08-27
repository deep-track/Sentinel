import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { buildVerificationReference } from "./lib/crypto";
import { requireClientRole } from "./lib/rbac";

const deliveryMethod = v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("email"));
const internalApi: any = internal;

export const submit = mutation({
  args: { clientId: v.id("clients"), contact: v.string(), method: deliveryMethod },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const contact = args.contact.trim();
    if (!contact) throw new ConvexError({ code: "invalid_argument", message: "A phone number or email is required." });
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    if (args.method === "email") throw new ConvexError({ code: "unsupported", message: "Email delivery is not configured. Use SMS or WhatsApp." });
    const now = Date.now();
    const verificationId = await ctx.db.insert("verifications", { clientId: args.clientId, type: "liveness", status: "queued", creditsUsed: 0, input: { contact, method: args.method }, reference: buildVerificationReference(), createdAt: now, updatedAt: now });
    const requestId = await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact, method: args.method, status: "pending", deliveryStatus: "pending", verificationId, createdAt: now, sentAt: now });
    await ctx.scheduler.runAfter(0, internalApi.liveness.dispatch, { requestId });
    return { requestId, verificationId };
  },
});

export const dispatch = internalAction({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internalApi.liveness.getInternal, { requestId: args.requestId });
    if (!request) return;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = request.method === "whatsapp" ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
    const callbackBase = process.env.LIVENESS_PUBLIC_URL;
    if (!sid || !token || !from || !callbackBase) {
      await ctx.runMutation(internalApi.liveness.markDeliveryFailed, { requestId: args.requestId, reason: "Liveness delivery provider is not configured." });
      return;
    }
    const to = request.method === "whatsapp" ? (request.contact.startsWith("whatsapp:") ? request.contact : `whatsapp:${request.contact}`) : request.contact;
    const link = `${callbackBase.replace(/\/$/, "")}/liveness/${request._id}`;
        const deliveryCallback = process.env.LIVENESS_DELIVERY_CALLBACK_URL;
    const body = new URLSearchParams({ To: to, From: from, Body: `Complete your Deeptrack liveness verification: ${link}`, ...(deliveryCallback ? { StatusCallback: deliveryCallback } : {}) });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) {
      await ctx.runMutation(internalApi.liveness.markDeliveryFailed, { requestId: args.requestId, reason: `Provider returned HTTP ${response.status}.` });
      return;
    }
    const result = await response.json() as { sid?: string };
    await ctx.runMutation(internalApi.liveness.markSent, { requestId: args.requestId, providerMessageId: result.sid ?? "unknown" });
  },
});

export const getInternal = internalQuery({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => await ctx.db.get(args.requestId),
});

export const markSent = internalMutation({
  args: { requestId: v.id("livenessRequests"), providerMessageId: v.string() },
  handler: async (ctx, args) => { const row = await ctx.db.get(args.requestId); if (row && row.deliveryStatus === "pending") await ctx.db.patch(args.requestId, { deliveryStatus: "sent", providerMessageId: args.providerMessageId }); },
});

export const markDeliveryFailed = internalMutation({
  args: { requestId: v.id("livenessRequests"), reason: v.string() },
  handler: async (ctx, args) => { const row = await ctx.db.get(args.requestId); if (row && row.deliveryStatus !== "sent") await ctx.db.patch(args.requestId, { deliveryStatus: "failed", status: "failed", failureReason: args.reason }); },
});

export const applyDeliveryCallback = internalMutation({
  args: { providerMessageId: v.string(), deliveryStatus: v.union(v.literal("sent"), v.literal("failed")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("livenessRequests").withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId)).unique();
    if (!row) return { accepted: false };
    if (row.deliveryStatus === "failed" || row.deliveryStatus === "sent") return { accepted: true, duplicate: true };
    await ctx.db.patch(row._id, { deliveryStatus: args.deliveryStatus, failureReason: args.deliveryStatus === "failed" ? (args.reason ?? "Delivery failed.") : undefined });
    return { accepted: true };
  },
});

export const applyCallback = internalMutation({
  args: { providerMessageId: v.string(), status: v.union(v.literal("completed"), v.literal("failed")), verdict: v.optional(v.union(v.literal("pass"), v.literal("review"), v.literal("reject"))), result: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("livenessRequests").withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId)).unique();
    if (!row) return { accepted: false };
    if (row.status !== "pending") return { accepted: true, duplicate: true };
    const now = Date.now();
    await ctx.db.patch(row._id, { status: args.status, completedAt: now, failureReason: args.status === "failed" ? "Liveness provider reported failure." : undefined });
    if (row.verificationId) {
      if (args.status === "completed") await ctx.runMutation(internalApi.verifications._complete, { id: row.verificationId, verdict: args.verdict ?? "review", confidence: 0, result: args.result ?? { source: "liveness_callback" } });
      else await ctx.runMutation(internalApi.verifications._fail, { id: row.verificationId, reason: "Liveness provider reported failure." });
    }
    return { accepted: true };
  },
});

export const list = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const rows = await ctx.db.query("livenessRequests").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
});

export const status = query({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    await requireClientRole(ctx, request.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    return request;
  },
});
