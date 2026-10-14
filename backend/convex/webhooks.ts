import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import type { ClientRole } from "./lib/rbac";
import { randomKeySegment } from "./lib/crypto";
import { assertSafeWebhookUrl } from "./lib/urlSafety";
import { queueForType } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { notify } from "./notifications";
import {
  DEFAULT_ENDPOINT_EVENTS,
  MAX_ENDPOINTS_PER_CLIENT,
  MAX_WEBHOOK_ATTEMPTS,
  PAUSE_AFTER_CONSECUTIVE_FAILURES,
  SECRET_ROTATION_GRACE_MS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PRODUCTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  buildFailureWebhookPayload,
  buildWebhookPayload,
  deliverWebhook,
  endpointWants,
  sanitizeWebhookResult,
  validateCustomHeaders,
  type WebhookPayload,
} from "./lib/webhookDispatch";

// Client webhooks. A client has up to MAX_ENDPOINTS_PER_CLIENT endpoints,
// each with its own URL, secret, events, products, environment and custom
// headers. Each delivery is retried on WEBHOOK_RETRY_SCHEDULE_MS; an
// endpoint failing PAUSE_AFTER_CONSECUTIVE_FAILURES attempts in a row is
// paused (its deliveries are held) and the client is alerted. Clients
// created before endpoints existed keep clients.webhookUrl / webhookSecret
// until ensureEndpoints moves them into an endpoint.

const internalApi: any = internal;
const MAX_DELIVERIES_LISTED = 100;
const MAX_ATTEMPTS_KEPT = 10;
const HEALTH_SAMPLE = 200;
const MAX_REQUEUE = 200;

const MANAGER_ROLES: ClientRole[] = ["client_admin", "developer"];
const READ_ROLES: ClientRole[] = ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"];
const RESEND_ROLES: ClientRole[] = ["client_admin", "compliance_analyst", "reviewer", "developer"];
const EVENT_VALUES: string[] = WEBHOOK_EVENT_TYPES.map((event) => event.value);
const PRODUCT_VALUES: string[] = WEBHOOK_PRODUCTS.map((product) => product.value);
const environmentValidator = v.union(v.literal("live"), v.literal("test"), v.literal("all"));
const headerValidator = v.array(v.object({ name: v.string(), value: v.optional(v.string()) }));

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function newSecret() {
  return randomKeySegment(32);
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ── Endpoints ──────────────────────────────────────────────────────────────

async function endpointsOf(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  return await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .take(MAX_ENDPOINTS_PER_CLIENT + 5);
}

// Moves a client's single legacy webhook into an endpoint the first time
// it's needed. Returns the client's endpoints.
export async function ensureEndpointsFor(ctx: MutationCtx, clientId: Id<"clients">) {
  const existing = await endpointsOf(ctx, clientId);
  const client = await ctx.db.get(clientId);
  if (!client?.webhookUrl || !client.webhookSecret) return existing;
  if (existing.length === 0) {
    const now = Date.now();
    await ctx.db.insert("webhookEndpoints", {
      clientId,
      url: client.webhookUrl,
      secret: client.webhookSecret,
      events: client.webhookEvents?.length ? client.webhookEvents : [...DEFAULT_ENDPOINT_EVENTS],
      environment: "all",
      status: "active",
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(clientId, { webhookUrl: undefined, webhookSecret: undefined, webhookEvents: undefined });
  return await endpointsOf(ctx, clientId);
}

async function loadEndpoint(ctx: MutationCtx, endpointId: Id<"webhookEndpoints">, roles: ClientRole[] = MANAGER_ROLES) {
  const endpoint = await ctx.db.get(endpointId);
  if (!endpoint) throw new ConvexError({ code: "not_found", message: "Webhook endpoint not found." });
  const actor = await requireClientRole(ctx, endpoint.clientId, roles);
  return { endpoint, actor };
}

async function auditEndpoint(
  ctx: MutationCtx,
  actor: { userId: string; role: string },
  endpoint: Pick<Doc<"webhookEndpoints">, "_id" | "clientId" | "url">,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  // Never log secrets or header values.
  await recordAudit(ctx, {
    actorId: actor.userId,
    actorType: actorTypeForClientRole(actor.role),
    action,
    targetType: "webhookEndpoint",
    targetId: endpoint._id,
    clientId: endpoint.clientId,
    metadata: { host: safeHost(endpoint.url), ...metadata },
  });
}

function cleanEvents(events: string[]) {
  const unique = [...new Set(events)];
  if (unique.length === 0) invalid("Choose at least one event.");
  if (unique.some((event) => !EVENT_VALUES.includes(event))) invalid("Unknown webhook event.");
  return unique;
}

function cleanProducts(products: string[] | null | undefined) {
  if (products === null || products === undefined) return undefined;
  const unique = [...new Set(products)];
  if (unique.length === 0) invalid("Choose at least one product, or send every product.");
  if (unique.some((product) => !PRODUCT_VALUES.includes(product))) invalid("Unknown product.");
  return unique.length === PRODUCT_VALUES.length ? undefined : unique;
}

function cleanDescription(description: string | undefined) {
  const trimmed = description?.trim() || undefined;
  if (trimmed && trimmed.length > 100) invalid("The description is at most 100 characters.");
  return trimmed;
}

// Header updates may omit a value to keep the one already stored.
function mergeHeaders(input: Array<{ name: string; value?: string }>, current: Array<{ name: string; value: string }>) {
  const merged = input.map((header) => ({
    name: header.name,
    value: header.value ?? current.find((item) => item.name.toLowerCase() === header.name.trim().toLowerCase())?.value ?? "",
  }));
  const result = validateCustomHeaders(merged);
  if (typeof result === "string") invalid(result);
  return result;
}

export const ensureEndpoints = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, READ_ROLES);
    await ensureEndpointsFor(ctx, args.clientId);
    return null;
  },
});

// The secret is returned once.
export const createEndpoint = mutation({
  args: {
    clientId: v.id("clients"),
    url: v.string(),
    description: v.optional(v.string()),
    events: v.array(v.string()),
    products: v.optional(v.union(v.array(v.string()), v.null())),
    environment: environmentValidator,
    headers: v.optional(headerValidator),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, MANAGER_ROLES);
    const existing = await ensureEndpointsFor(ctx, args.clientId);
    if (existing.length >= MAX_ENDPOINTS_PER_CLIENT) invalid(`You can have at most ${MAX_ENDPOINTS_PER_CLIENT} endpoints.`);
    const url = assertSafeWebhookUrl(args.url);
    const secret = newSecret();
    const now = Date.now();
    const endpointId = await ctx.db.insert("webhookEndpoints", {
      clientId: args.clientId,
      url,
      description: cleanDescription(args.description),
      secret,
      events: cleanEvents(args.events),
      products: cleanProducts(args.products),
      environment: args.environment,
      headers: mergeHeaders(args.headers ?? [], []),
      status: "active",
      consecutiveFailures: 0,
      createdAt: now,
      createdBy: actor.userId,
      updatedAt: now,
    });
    await auditEndpoint(ctx, actor, { _id: endpointId, clientId: args.clientId, url }, "webhook.endpoint_created", {
      events: args.events,
      environment: args.environment,
    });
    return { endpointId, secret };
  },
});

export const updateEndpoint = mutation({
  args: {
    endpointId: v.id("webhookEndpoints"),
    url: v.optional(v.string()),
    description: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    products: v.optional(v.union(v.array(v.string()), v.null())),
    environment: v.optional(environmentValidator),
    headers: v.optional(headerValidator),
  },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    const patch: Partial<Doc<"webhookEndpoints">> = { updatedAt: Date.now() };
    if (args.url !== undefined) patch.url = assertSafeWebhookUrl(args.url);
    if (args.description !== undefined) patch.description = cleanDescription(args.description);
    if (args.events !== undefined) patch.events = cleanEvents(args.events);
    if (args.products !== undefined) patch.products = cleanProducts(args.products);
    if (args.environment !== undefined) patch.environment = args.environment;
    if (args.headers !== undefined) patch.headers = mergeHeaders(args.headers, endpoint.headers ?? []);
    await ctx.db.patch(endpoint._id, patch);
    await auditEndpoint(ctx, actor, { ...endpoint, url: patch.url ?? endpoint.url }, "webhook.endpoint_updated", {
      changed: Object.keys(patch).filter((key) => key !== "updatedAt"),
      ...(patch.url ? { previousHost: safeHost(endpoint.url) } : {}),
    });
    return null;
  },
});

export const deleteEndpoint = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    await ctx.db.delete(endpoint._id);
    await auditEndpoint(ctx, actor, endpoint, "webhook.endpoint_deleted");
    return null;
  },
});

// A new secret that deliveries are signed with in X-Sentinel-Signature-V2-Next
// until it's activated (or after 24 hours), so receivers switch without a
// gap. Returned once.
export const rotateSecret = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    const nextSecret = newSecret();
    const now = Date.now();
    await ctx.db.patch(endpoint._id, { nextSecret, nextSecretCreatedAt: now, updatedAt: now });
    await auditEndpoint(ctx, actor, endpoint, "webhook.secret_rotated", { activatesAt: now + SECRET_ROTATION_GRACE_MS });
    return { secret: nextSecret, activatesAt: now + SECRET_ROTATION_GRACE_MS };
  },
});

export const activateSecret = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    if (!endpoint.nextSecret) invalid("There's no new secret waiting to be activated.");
    await ctx.db.patch(endpoint._id, { secret: endpoint.nextSecret, nextSecret: undefined, nextSecretCreatedAt: undefined, updatedAt: Date.now() });
    await auditEndpoint(ctx, actor, endpoint, "webhook.secret_activated");
    return null;
  },
});

export const pauseEndpoint = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    if (endpoint.status === "paused") return null;
    await ctx.db.patch(endpoint._id, { status: "paused", pausedAt: Date.now(), pausedReason: "Paused by your team", updatedAt: Date.now() });
    await auditEndpoint(ctx, actor, endpoint, "webhook.endpoint_paused");
    return null;
  },
});

// Resumes an endpoint and sends the deliveries held while it was paused.
export const resumeEndpoint = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    await ctx.db.patch(endpoint._id, { status: "active", pausedAt: undefined, pausedReason: undefined, consecutiveFailures: 0, updatedAt: Date.now() });
    const held = (
      await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_endpoint", (q) => q.eq("endpointId", endpoint._id))
        .order("desc")
        .take(1000)
    )
      .filter((row) => row.status === "paused")
      .slice(0, MAX_REQUEUE);
    await requeue(ctx, held);
    await auditEndpoint(ctx, actor, endpoint, "webhook.endpoint_resumed", { requeued: held.length });
    return { requeued: held.length };
  },
});

// Sends deliveries again, oldest first, a second apart.
async function requeue(ctx: MutationCtx, rows: Array<Doc<"webhookDeliveries">>) {
  const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  for (let index = 0; index < ordered.length; index++) {
    await ctx.db.patch(ordered[index]._id, { status: "pending", attemptCount: 0, nextRetryAt: undefined });
    await ctx.scheduler.runAfter(index * 1000, internalApi.webhooks.attemptDelivery, { deliveryId: ordered[index]._id });
  }
}

export const sendTest = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId);
    const now = Date.now();
    const payload: WebhookPayload = {
      event: "sentinel.test",
      scan_id: `test_${randomKeySegment(12)}`,
      status: "PASS",
      timestamp: new Date(now).toISOString(),
      product: null,
      result: { test: true, message: "A test event from Sentinel. Verify the signature, then return any 2xx status." },
    };
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      clientId: endpoint.clientId,
      endpointId: endpoint._id,
      event: payload.event,
      status: "pending",
      attemptCount: 0,
      test: true,
      payload,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internalApi.webhooks.attemptDelivery, { deliveryId });
    await auditEndpoint(ctx, actor, endpoint, "webhook.test_sent");
    return { deliveryId };
  },
});

// ── Dispatch ───────────────────────────────────────────────────────────────

function productOf(verification: Doc<"verifications">) {
  return queueForType(verification.type);
}

function isSandbox(verification: Doc<"verifications">) {
  return Boolean((verification.input as { sandbox?: unknown } | null)?.sandbox || (verification.result as { sandbox?: unknown } | null)?.sandbox);
}

async function insertDeliveries(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  items: Array<{ endpoint: Doc<"webhookEndpoints">; payload: WebhookPayload; verificationId?: Id<"verifications"> }>,
) {
  const now = Date.now();
  for (const { endpoint, payload, verificationId } of items) {
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      clientId,
      ...(verificationId ? { verificationId } : {}),
      endpointId: endpoint._id,
      event: payload.event,
      status: endpoint.status === "paused" ? "paused" : "pending",
      ...(endpoint.status === "paused" ? { lastError: "endpoint_paused" } : {}),
      attemptCount: 0,
      payload,
      createdAt: now,
    });
    if (endpoint.status !== "paused") {
      await ctx.scheduler.runAfter(0, internalApi.webhooks.attemptDelivery, { deliveryId });
    }
  }
}

// One delivery per endpoint that wants this check's result. After a review
// decision, endpoints subscribed to review.decided get that event instead
// of a second scan.complete.
export const _queueForVerification = internalMutation({
  args: { verificationId: v.id("verifications"), reviewDecided: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) return 0;
    const endpoints = await ensureEndpointsFor(ctx, verification.clientId);
    if (endpoints.length === 0) return 0;
    const product = productOf(verification);
    const sandbox = isSandbox(verification);
    const base =
      verification.status === "failed"
        ? buildFailureWebhookPayload({ reference: verification.reference, failureReason: verification.failureReason })
        : buildWebhookPayload({ reference: verification.reference, verdict: verification.verdict ?? "review", result: verification.result });
    base.product = product;

    let decided: WebhookPayload | null = null;
    if (args.reviewDecided && verification.status !== "failed") {
      const review = await ctx.db
        .query("reviewQueue")
        .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
        .order("desc")
        .first();
      if (review?.status === "resolved") {
        decided = {
          ...base,
          event: "sentinel.review.decided",
          review: {
            decision: review.resolutionAction === "confirm" ? "approved" : "rejected",
            decided_by: review.decisionSource ?? "deeptrack",
            reason: review.reasonCode ?? null,
            decided_at: new Date(review.resolvedAt ?? Date.now()).toISOString(),
          },
        };
      }
    }

    const items: Array<{ endpoint: Doc<"webhookEndpoints">; payload: WebhookPayload; verificationId: Id<"verifications"> }> = [];
    for (const endpoint of endpoints) {
      if (decided && endpointWants(endpoint, { event: decided.event, product, sandbox })) {
        items.push({ endpoint, payload: decided, verificationId: verification._id });
      } else if (endpointWants(endpoint, { event: base.event, product, sandbox })) {
        items.push({ endpoint, payload: base, verificationId: verification._id });
      }
    }
    await insertDeliveries(ctx, verification.clientId, items);
    return items.length;
  },
});

// Events that aren't about a check (low credits), from a mutation.
export async function queueClientEvent(ctx: MutationCtx, clientId: Id<"clients">, payload: WebhookPayload) {
  const endpoints = await ensureEndpointsFor(ctx, clientId);
  const items = endpoints
    .filter((endpoint) => endpointWants(endpoint, { event: payload.event, product: null, sandbox: false }))
    .map((endpoint) => ({ endpoint, payload: { ...payload, result: sanitizeWebhookResult(payload.result) } }));
  await insertDeliveries(ctx, clientId, items);
}

// Called (fire-and-forget, via scheduler) after a verification reaches a
// terminal state, and again after a review decision (reviewDecided).
export const dispatchWebhook = internalAction({
  args: { verificationId: v.id("verifications"), reviewDecided: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.webhooks._queueForVerification, args);
  },
});

type AttemptContext =
  | { skip: true }
  | {
      skip: false;
      url: string;
      payload: WebhookPayload;
      secret: string;
      nextSecret?: string;
      headers: Array<{ name: string; value: string }>;
      paused: boolean;
      missing: boolean;
    };

export const _attemptContext = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args): Promise<AttemptContext> => {
    const delivery = await ctx.db.get(args.deliveryId);
    // "failed" and "paused" are terminal until a resend or resume.
    if (!delivery || delivery.status === "delivered" || delivery.status === "failed" || delivery.status === "paused") return { skip: true };
    let endpoint = delivery.endpointId ? await ctx.db.get(delivery.endpointId) : null;
    if (!delivery.endpointId) {
      // A delivery from before endpoints: the client's legacy webhook, or the
      // endpoint it was moved into.
      const client = await ctx.db.get(delivery.clientId);
      if (client?.webhookUrl && client.webhookSecret) {
        return { skip: false, url: client.webhookUrl, payload: delivery.payload, secret: client.webhookSecret, headers: [], paused: false, missing: false };
      }
      endpoint = (await endpointsOf(ctx, delivery.clientId))[0] ?? null;
    }
    if (!endpoint) return { skip: false, url: "", payload: delivery.payload, secret: "", headers: [], paused: false, missing: true };
    // A rotated secret past its grace period signs as the main secret.
    const promoted = endpoint.nextSecret && endpoint.nextSecretCreatedAt !== undefined && Date.now() - endpoint.nextSecretCreatedAt >= SECRET_ROTATION_GRACE_MS;
    return {
      skip: false,
      url: endpoint.url,
      payload: delivery.payload,
      secret: promoted ? endpoint.nextSecret! : endpoint.secret,
      ...(endpoint.nextSecret && !promoted ? { nextSecret: endpoint.nextSecret } : {}),
      headers: endpoint.headers ?? [],
      paused: endpoint.status === "paused",
      missing: false,
    };
  },
});

// One delivery attempt. Retries on the schedule (1min/5min/30min/2hr/6hr/24hr);
// marks the delivery "failed" once the schedule is exhausted.
export const attemptDelivery = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const context: AttemptContext = await ctx.runQuery(internalApi.webhooks._attemptContext, args);
    if (context.skip) return;
    if (context.missing || context.paused) {
      await ctx.runMutation(internalApi.webhooks._recordAttempt, {
        deliveryId: args.deliveryId,
        outcome: context.missing ? "endpoint_removed" : "endpoint_paused",
      });
      return;
    }
    const result = await deliverWebhook(context.url, context.payload, context.secret, { nextSecret: context.nextSecret, headers: context.headers });
    await ctx.runMutation(internalApi.webhooks._recordAttempt, {
      deliveryId: args.deliveryId,
      outcome: "attempted",
      success: result.success,
      statusCode: result.statusCode,
      error: result.error,
      latencyMs: result.latencyMs,
      permanent: result.permanent,
    });
  },
});

export const _recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    outcome: v.union(v.literal("attempted"), v.literal("endpoint_removed"), v.literal("endpoint_paused")),
    success: v.optional(v.boolean()),
    statusCode: v.optional(v.number()),
    error: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    permanent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return;
    const now = Date.now();
    if (args.outcome === "endpoint_removed") {
      await ctx.db.patch(delivery._id, { status: "failed", lastError: "endpoint_removed", nextRetryAt: undefined });
      return;
    }
    if (args.outcome === "endpoint_paused") {
      await ctx.db.patch(delivery._id, { status: "paused", lastError: "endpoint_paused", nextRetryAt: undefined });
      return;
    }

    const attempts = [...(delivery.attempts ?? []), { at: now, statusCode: args.statusCode, error: args.error, latencyMs: args.latencyMs }].slice(-MAX_ATTEMPTS_KEPT);
    const attemptCount = delivery.attemptCount + 1;
    const common = { attempts, attemptCount, lastAttemptAt: now, lastResponseStatus: args.statusCode, lastError: args.success ? undefined : args.error, lastLatencyMs: args.latencyMs };
    const endpoint = delivery.endpointId ? await ctx.db.get(delivery.endpointId) : null;

    // Promote a rotated secret that has passed its grace period.
    if (endpoint?.nextSecret && endpoint.nextSecretCreatedAt !== undefined && now - endpoint.nextSecretCreatedAt >= SECRET_ROTATION_GRACE_MS) {
      await ctx.db.patch(endpoint._id, { secret: endpoint.nextSecret, nextSecret: undefined, nextSecretCreatedAt: undefined });
    }

    if (args.success) {
      await ctx.db.patch(delivery._id, { ...common, status: "delivered", nextRetryAt: undefined });
      if (endpoint && endpoint.consecutiveFailures !== 0 && !delivery.test) await ctx.db.patch(endpoint._id, { consecutiveFailures: 0 });
      return;
    }

    // Test events are sent once and never count towards pausing.
    if (delivery.test) {
      await ctx.db.patch(delivery._id, { ...common, status: "failed", nextRetryAt: undefined });
      return;
    }

    if (endpoint) {
      const failures = endpoint.consecutiveFailures + 1;
      await ctx.db.patch(endpoint._id, { consecutiveFailures: failures });
      if (failures >= PAUSE_AFTER_CONSECUTIVE_FAILURES && endpoint.status === "active") {
        await pauseFailingEndpoint(ctx, endpoint, args.statusCode ? `HTTP ${args.statusCode}` : args.error ?? "errors");
        await ctx.db.patch(delivery._id, { ...common, status: "paused", nextRetryAt: undefined });
        return;
      }
    }

    if (args.permanent || attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
      await ctx.db.patch(delivery._id, { ...common, status: "failed", nextRetryAt: undefined });
      return;
    }
    const nextRetryAt = now + WEBHOOK_RETRY_SCHEDULE_MS[delivery.attemptCount];
    await ctx.db.patch(delivery._id, { ...common, status: "retrying", nextRetryAt });
    await ctx.scheduler.runAt(nextRetryAt, internalApi.webhooks.attemptDelivery, { deliveryId: delivery._id });
  },
});

async function pauseFailingEndpoint(ctx: MutationCtx, endpoint: Doc<"webhookEndpoints">, lastProblem: string) {
  const now = Date.now();
  const reason = `Paused automatically after ${PAUSE_AFTER_CONSECUTIVE_FAILURES} failed attempts in a row (last: ${lastProblem}).`;
  await ctx.db.patch(endpoint._id, { status: "paused", pausedAt: now, pausedReason: reason, updatedAt: now });
  // Hold its other queued deliveries too.
  const queued = (
    await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpoint", (q) => q.eq("endpointId", endpoint._id))
      .order("desc")
      .take(500)
  ).filter((row) => row.status === "pending" || row.status === "retrying");
  for (const row of queued) await ctx.db.patch(row._id, { status: "paused", lastError: "endpoint_paused", nextRetryAt: undefined });
  await recordAudit(ctx, {
    actorId: "system",
    actorType: "system",
    action: "webhook.endpoint_auto_paused",
    targetType: "webhookEndpoint",
    targetId: endpoint._id,
    clientId: endpoint.clientId,
    metadata: { host: safeHost(endpoint.url), reason, held: queued.length },
  });
  await notify(ctx, {
    clientId: endpoint.clientId,
    event: "webhook_failing",
    title: `Webhook paused: ${safeHost(endpoint.url) ?? endpoint.url}`,
    body: `${reason} Deliveries are held until you fix the endpoint and resume it in Settings → Developers.`,
    link: "/settings/developers",
  });
}

// ── Resend ─────────────────────────────────────────────────────────────────

// Sends a delivery again (failed, delivered or held ones; not one already
// queued, which would start a second retry chain).
export const resendWebhook = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) throw new ConvexError({ code: "not_found", message: "Delivery not found." });
    const actor = await requireClientRole(ctx, delivery.clientId, RESEND_ROLES);
    if (delivery.status === "pending" || delivery.status === "retrying") {
      throw new ConvexError({ code: "invalid_state", message: "This delivery is already queued." });
    }
    const endpoint = delivery.endpointId ? await ctx.db.get(delivery.endpointId) : null;
    if (endpoint?.status === "paused") invalid("Resume the endpoint first.");
    await requeue(ctx, [delivery]);
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "webhook.resent",
      targetType: "webhookDelivery",
      targetId: delivery._id,
      clientId: delivery.clientId,
    });
    return null;
  },
});

export const resendFailed = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const { endpoint, actor } = await loadEndpoint(ctx, args.endpointId, RESEND_ROLES);
    if (endpoint.status === "paused") invalid("Resume the endpoint first.");
    const failed = (
      await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_endpoint", (q) => q.eq("endpointId", endpoint._id))
        .order("desc")
        .take(1000)
    )
      .filter((row) => row.status === "failed" && !row.test)
      .slice(0, MAX_REQUEUE);
    await requeue(ctx, failed);
    await auditEndpoint(ctx, actor, endpoint, "webhook.failed_resent", { count: failed.length });
    return { requeued: failed.length };
  },
});

// ── Portal (Settings → Developers, Webhooks page) ──────────────────────────

function deliverySummary(row: Doc<"webhookDeliveries">, reference: string | null) {
  return {
    _id: row._id,
    endpointId: row.endpointId ?? null,
    status: row.status,
    event: row.event ?? (row.payload as { event?: string } | null)?.event ?? null,
    reference: reference ?? (row.payload as { scan_id?: string } | null)?.scan_id ?? null,
    test: row.test === true,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt ?? null,
    nextRetryAt: row.nextRetryAt ?? null,
    lastResponseStatus: row.lastResponseStatus ?? null,
    lastError: row.lastError ?? null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    createdAt: row.createdAt,
  };
}

function maskHeader(header: { name: string; value: string }) {
  return { name: header.name, preview: header.value.length > 4 ? `••••${header.value.slice(-4)}` : "••••" };
}

export const getForClient = query({
  args: {
    clientId: v.id("clients"),
    status: v.optional(v.string()),
    endpointId: v.optional(v.id("webhookEndpoints")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, READ_ROLES);
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
    const endpoints = await endpointsOf(ctx, args.clientId);
    const recent = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(1000);
    const search = args.search?.trim().toLowerCase();
    const filtered = recent.filter(
      (row) =>
        (!args.status || row.status === args.status) &&
        (!args.endpointId || row.endpointId === args.endpointId) &&
        (!search || String((row.payload as { scan_id?: unknown } | null)?.scan_id ?? "").toLowerCase().includes(search)),
    );
    const listed = filtered.slice(0, MAX_DELIVERIES_LISTED);
    const verifications = await Promise.all(listed.map((row) => (row.verificationId ? ctx.db.get(row.verificationId) : null)));
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return {
      legacyPending: Boolean(client.webhookUrl && client.webhookSecret),
      endpoints: endpoints.map((endpoint) => {
        const sample = recent.filter((row) => row.endpointId === endpoint._id && !row.test && row.createdAt >= weekAgo && row.attemptCount > 0).slice(0, HEALTH_SAMPLE);
        const delivered = sample.filter((row) => row.status === "delivered");
        const latencies = sample.map((row) => row.lastLatencyMs).filter((value): value is number => typeof value === "number");
        return {
          _id: endpoint._id,
          url: endpoint.url,
          description: endpoint.description ?? null,
          events: endpoint.events,
          products: endpoint.products ?? null,
          environment: endpoint.environment,
          headers: (endpoint.headers ?? []).map(maskHeader),
          status: endpoint.status,
          pausedAt: endpoint.pausedAt ?? null,
          pausedReason: endpoint.pausedReason ?? null,
          consecutiveFailures: endpoint.consecutiveFailures,
          rotation: endpoint.nextSecretCreatedAt ? { createdAt: endpoint.nextSecretCreatedAt, activatesAt: endpoint.nextSecretCreatedAt + SECRET_ROTATION_GRACE_MS } : null,
          held: recent.filter((row) => row.endpointId === endpoint._id && row.status === "paused").length,
          failed: recent.filter((row) => row.endpointId === endpoint._id && row.status === "failed" && !row.test).length,
          health: {
            sent: sample.length,
            successRate: sample.length ? Math.round((delivered.length / sample.length) * 1000) / 10 : null,
            avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
          },
          createdAt: endpoint.createdAt,
        };
      }),
      deliveries: listed.map((row, index) => deliverySummary(row, verifications[index]?.reference ?? null)),
      options: {
        events: WEBHOOK_EVENT_TYPES,
        products: WEBHOOK_PRODUCTS,
        maxEndpoints: MAX_ENDPOINTS_PER_CLIENT,
        pauseAfter: PAUSE_AFTER_CONSECUTIVE_FAILURES,
      },
    };
  },
});

export const getDelivery = query({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;
    await requireClientRole(ctx, delivery.clientId, READ_ROLES);
    const [verification, endpoint] = await Promise.all([
      delivery.verificationId ? ctx.db.get(delivery.verificationId) : null,
      delivery.endpointId ? ctx.db.get(delivery.endpointId) : null,
    ]);
    return {
      ...deliverySummary(delivery, verification?.reference ?? null),
      endpointUrl: endpoint?.url ?? null,
      payload: delivery.payload,
      attempts: delivery.attempts ?? [],
    };
  },
});
