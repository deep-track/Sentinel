import { ConvexError, v } from "convex/values";
import { HOUR } from "@convex-dev/rate-limiter";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { buildVerificationReference } from "./lib/crypto";
import { requireClientRole } from "./lib/rbac";
import { rateLimiter } from "./lib/rateLimits";
import { assertCredits, chargeVerification } from "./lib/credits";
import { creditsForType } from "./lib/verificationTypes";

// "email" stays in the validator so older clients get a clear error instead of
// a validation failure; it is always rejected below.
const deliveryMethod = v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("email"));
const deliveryStatusUpdate = v.union(v.literal("sent"), v.literal("delivered"), v.literal("failed"), v.literal("undelivered"));
const internalApi: any = internal;

const TWILIO_TIMEOUT_MS = 15_000;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// SMS toll-fraud guard: each invitation costs real money on Sentinel's Twilio
// account. Per client, and per destination number within a client.
const PER_CLIENT_LIMIT = { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 } as const;
const PER_CONTACT_LIMIT = { kind: "token bucket", rate: 3, period: HOUR, capacity: 3 } as const;

// Delivery states only move forward; failed/undelivered/delivered are final.
const DELIVERY_RANK: Record<Doc<"livenessRequests">["deliveryStatus"], number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  failed: 2,
  undelivered: 2,
};

// Accepts common formatting ("+254 700-000 000", "00254...", "whatsapp:+...")
// and returns strict E.164, or null.
function normalizePhoneNumber(raw: string): string | null {
  let value = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  return E164_PATTERN.test(value) ? value : null;
}

function rateLimited(retryAfterMs: number | undefined, message: string): ConvexError<{ code: string; message: string; retryAfterMs: number }> {
  return new ConvexError({ code: "rate_limited", message, retryAfterMs: Math.ceil(retryAfterMs ?? 0) });
}

export const submit = mutation({
  args: { clientId: v.id("clients"), contact: v.string(), method: deliveryMethod },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    if (args.method === "email") {
      throw new ConvexError({ code: "unsupported", message: "Email delivery is not available. Use SMS or WhatsApp." });
    }
    const contact = normalizePhoneNumber(args.contact);
    if (!contact) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "Enter the phone number in international format, e.g. +254700000000.",
      });
    }
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });

    // Liveness is billed when the provider accepts the SMS (markSent), not on
    // completion, so plain assertCredits is used rather than the in-flight
    // reservation helper (which assumes queued rows are still unbilled).
    const creditsUsed = creditsForType("liveness");
    await assertCredits(ctx, args.clientId, creditsUsed);

    const perClient = await rateLimiter.limit(ctx, "livenessInvitePerClient", { key: args.clientId, config: PER_CLIENT_LIMIT });
    if (!perClient.ok) throw rateLimited(perClient.retryAfter, "Too many liveness invitations. Try again later.");
    const perContact = await rateLimiter.limit(ctx, "livenessInvitePerContact", { key: `${args.clientId}:${contact}`, config: PER_CONTACT_LIMIT });
    if (!perContact.ok) throw rateLimited(perContact.retryAfter, "Too many invitations to this number. Try again later.");

    const now = Date.now();
    const verificationId = await ctx.db.insert("verifications", { clientId: args.clientId, type: "liveness", status: "queued", creditsUsed, input: { contact, method: args.method }, reference: buildVerificationReference(), createdAt: now, updatedAt: now });
    const requestId = await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact, method: args.method, status: "pending", deliveryStatus: "pending", verificationId, createdAt: now, sentAt: now });
    await ctx.scheduler.runAfter(0, internalApi.liveness.dispatch, { requestId });
    return { requestId, verificationId };
  },
});

type SendOutcome = { ok: true; sid: string } | { ok: false; reason: string };

async function sendTwilioMessage(sid: string, token: string, body: URLSearchParams): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[liveness.dispatch] Twilio returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      return { ok: false, reason: `Provider returned HTTP ${response.status}.` };
    }
    const result = (await response.json().catch(() => null)) as { sid?: unknown } | null;
    const messageSid = typeof result?.sid === "string" ? result.sid.trim() : "";
    // Never store a placeholder id: a message we can't correlate is a failure.
    if (!messageSid) return { ok: false, reason: "Provider response did not include a message id." };
    return { ok: true, sid: messageSid };
  } catch (error) {
    const aborted = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
    console.error("[liveness.dispatch] Twilio request failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: aborted ? "Provider request timed out." : "Provider request failed." };
  } finally {
    clearTimeout(timer);
  }
}

export const dispatch = internalAction({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => {
    const request: Doc<"livenessRequests"> | null = await ctx.runQuery(internalApi.liveness.getInternal, { requestId: args.requestId });
    if (!request || request.status !== "pending" || request.deliveryStatus !== "pending") return;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = request.method === "whatsapp" ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
    const callbackBase = process.env.LIVENESS_PUBLIC_URL;
    if (request.method === "email" || !sid || !token || !from || !callbackBase) {
      await ctx.runMutation(internalApi.liveness.markDeliveryFailed, { requestId: args.requestId, reason: "Liveness delivery provider is not configured." });
      return;
    }
    const to = request.method === "whatsapp" ? `whatsapp:${request.contact.replace(/^whatsapp:/i, "")}` : request.contact;
    const link = `${callbackBase.replace(/\/$/, "")}/liveness/${request._id}`;
    const deliveryCallback = process.env.LIVENESS_DELIVERY_CALLBACK_URL;
    const body = new URLSearchParams({ To: to, From: from, Body: `Complete your Deeptrack liveness verification: ${link}`, ...(deliveryCallback ? { StatusCallback: deliveryCallback } : {}) });
    const outcome = await sendTwilioMessage(sid, token, body);
    if (!outcome.ok) {
      await ctx.runMutation(internalApi.liveness.markDeliveryFailed, { requestId: args.requestId, reason: outcome.reason });
      return;
    }
    await ctx.runMutation(internalApi.liveness.markSent, { requestId: args.requestId, providerMessageId: outcome.sid });
  },
});

export const getInternal = internalQuery({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => await ctx.db.get(args.requestId),
});

// Fails the request AND its linked verification (unless that verification has
// already finished), and notifies the client.
async function failRequest(
  ctx: MutationCtx,
  row: Doc<"livenessRequests">,
  reason: string,
  deliveryStatus?: Doc<"livenessRequests">["deliveryStatus"],
) {
  const now = Date.now();
  await ctx.db.patch(row._id, { status: "failed", failureReason: reason, completedAt: now, ...(deliveryStatus ? { deliveryStatus } : {}) });
  if (!row.verificationId) return;
  const verification = await ctx.db.get(row.verificationId);
  if (!verification || verification.status === "completed" || verification.status === "failed") return;
  await ctx.runMutation(internal.verifications._fail, { id: row.verificationId, reason });
  await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: row.verificationId });
}

export const markSent = internalMutation({
  args: { requestId: v.id("livenessRequests"), providerMessageId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.status !== "pending" || row.deliveryStatus !== "pending") return;
    const providerMessageId = args.providerMessageId.trim();
    if (!providerMessageId) {
      await failRequest(ctx, row, "Provider response did not include a message id.", "failed");
      return;
    }
    await ctx.db.patch(args.requestId, { deliveryStatus: "sent", providerMessageId, sentAt: Date.now() });
    // Billed once the provider has accepted the message (the SMS cost is
    // incurred from here). Idempotent per verification.
    if (row.verificationId) {
      const verification = await ctx.db.get(row.verificationId);
      if (verification) {
        await chargeVerification(ctx, {
          clientId: row.clientId,
          verificationId: row.verificationId,
          amount: verification.creditsUsed,
          reason: "Liveness check invitation sent",
        });
      }
    }
  },
});

export const markDeliveryFailed = internalMutation({
  args: { requestId: v.id("livenessRequests"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    // Only for failures before the provider accepted the message; later
    // failures arrive through applyDeliveryCallback.
    if (!row || row.status !== "pending" || row.deliveryStatus !== "pending") return;
    await failRequest(ctx, row, args.reason, "failed");
  },
});

export const applyDeliveryCallback = internalMutation({
  args: { providerMessageId: v.string(), deliveryStatus: deliveryStatusUpdate, reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("livenessRequests").withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId)).unique();
    if (!row) return { accepted: false };
    // Out-of-order or repeated callbacks never move the state backwards.
    if (DELIVERY_RANK[args.deliveryStatus] <= DELIVERY_RANK[row.deliveryStatus]) return { accepted: true, duplicate: true };
    if (args.deliveryStatus === "failed" || args.deliveryStatus === "undelivered") {
      const detail = args.reason?.trim().slice(0, 200) || (args.deliveryStatus === "undelivered" ? "Message could not be delivered." : "Delivery failed.");
      if (row.status === "pending") {
        await failRequest(ctx, row, `Liveness link ${args.deliveryStatus}: ${detail}`, args.deliveryStatus);
      } else {
        // The subject already finished (or the request already failed).
        await ctx.db.patch(row._id, { deliveryStatus: args.deliveryStatus });
      }
      return { accepted: true };
    }
    await ctx.db.patch(row._id, { deliveryStatus: args.deliveryStatus });
    return { accepted: true };
  },
});

export const applyCallback = internalMutation({
  args: { providerMessageId: v.string(), status: v.union(v.literal("completed"), v.literal("failed")), verdict: v.optional(v.union(v.literal("pass"), v.literal("review"), v.literal("reject"))), result: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("livenessRequests").withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId)).unique();
    if (!row) return { accepted: false };
    if (row.status !== "pending") return { accepted: true, duplicate: true };
    if (args.status === "failed") {
      await failRequest(ctx, row, "Liveness provider reported failure.");
      return { accepted: true };
    }
    await ctx.db.patch(row._id, { status: "completed", completedAt: Date.now(), failureReason: undefined });
    if (row.verificationId) {
      const verification = await ctx.db.get(row.verificationId);
      if (verification && verification.status !== "completed" && verification.status !== "failed") {
        // A missing verdict fails closed to review.
        const verdict = args.verdict ?? "review";
        const result = args.result ?? { source: "liveness_callback" };
        if (verdict === "review") {
          // Same path as IDP review outcomes: completes with verdict "review"
          // and inserts the reviewQueue row.
          await ctx.runMutation(internal.verifications._completeWithReview, {
            id: row.verificationId,
            clientId: row.clientId,
            result,
            triggerType: "auto_escalation",
            triggerReason: args.verdict ? "Liveness provider returned a review verdict" : "Liveness provider returned no verdict",
            priority: "normal",
          });
        } else {
          await ctx.runMutation(internal.verifications._complete, {
            id: row.verificationId,
            verdict,
            confidence: verdict === "pass" ? 1 : 0,
            result,
          });
        }
        await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: row.verificationId });
      }
    }
    return { accepted: true };
  },
});

export const list = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    return await ctx.db.query("livenessRequests").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).order("desc").take(limit);
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
