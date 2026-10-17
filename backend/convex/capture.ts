import { ConvexError, v } from "convex/values";
import { HOUR } from "@convex-dev/rate-limiter";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClientRole } from "./lib/rbac";
import { rateLimiter } from "./lib/rateLimits";
import { randomKeySegment, sha256Hex } from "./lib/crypto";
import { assertMediaSize } from "./lib/verificationTypes";
import { recordAudit } from "./auditLog";
import { normalizePhoneNumber, sendInvitation } from "./liveness";
import { createIdpVerification } from "./verifications";
import {
  CAPTURE_LINK_HOURS,
  captureLink,
  captureMessage,
  effectiveStatus,
  isCaptureToken,
  missingDetails,

  type CapturePrefill,
} from "./lib/capture";

// Kenya capture (lib/capture.ts): the client creates a link; the customer
// opens it on their phone (no account), photographs their ID and takes a
// selfie; that becomes an ordinary KYC check, billed when submitted.

const internalApi: any = internal;

const SEND_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer"] as const;
const PER_CLIENT_LIMIT = { kind: "token bucket", rate: 100, period: HOUR, capacity: 30 } as const;
const PER_CONTACT_LIMIT = { kind: "token bucket", rate: 3, period: HOUR, capacity: 3 } as const;
// Submissions per link: a few retries on a bad connection, no more.
const PER_LINK_LIMIT = { kind: "token bucket", rate: 5, period: HOUR, capacity: 5 } as const;

const language = v.union(v.literal("en"), v.literal("sw"));
const prefillValidator = v.object({
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  idNumber: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  gender: v.optional(v.string()),
});

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function appUrl(): string {
  return (process.env.SENTINEL_APP_URL?.trim() || "https://sentinel.deeptrack.io").replace(/\/+$/, "");
}

function cleanPrefill(prefill: CapturePrefill | undefined): CapturePrefill {
  const out: CapturePrefill = {};
  for (const [key, value] of Object.entries(prefill ?? {})) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length > 100) invalid(`${key} is too long.`);
    if (text) out[key as keyof CapturePrefill] = text;
  }
  if (out.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(out.dateOfBirth)) invalid("Date of birth must be YYYY-MM-DD.");
  return out;
}

type Method = "sms" | "whatsapp" | "link";
type CreateArgs = {
  clientId: Id<"clients">;
  method: Method;
  contact?: string;
  language: "en" | "sw";
  prefill?: CapturePrefill;
  externalRef?: string;
  actor: { actorId: string; actorType: "client_user" | "client_api_key" };
};

// Checks a link request without writing anything: the cleaned contact,
// prefill and reference. Shared by the dashboard, the API and test keys.
function validateLink(args: Pick<CreateArgs, "method" | "contact" | "prefill" | "externalRef">) {
  let contact: string | undefined;
  if (args.method !== "link") {
    contact = normalizePhoneNumber(args.contact ?? "") ?? undefined;
    if (!contact) invalid("Enter the phone number in international format, e.g. +254700000000.");
  }
  return { contact, prefill: cleanPrefill(args.prefill), externalRef: args.externalRef?.trim().slice(0, 100) || undefined };
}

// Creates a link. "link" returns it to share yourself; "sms" and "whatsapp"
// also send it. The link is only ever shown here, once.
async function createLink(ctx: MutationCtx, args: CreateArgs) {
  const client = await ctx.db.get(args.clientId);
  if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
  const { contact, prefill, externalRef } = validateLink(args);
  const perClient = await rateLimiter.limit(ctx, "captureLinkPerClient", { key: args.clientId, config: PER_CLIENT_LIMIT });
  if (!perClient.ok) throw new ConvexError({ code: "rate_limited", message: "Too many capture links. Try again later." });
  if (contact) {
    const perContact = await rateLimiter.limit(ctx, "captureLinkPerContact", { key: `${args.clientId}:${contact}`, config: PER_CONTACT_LIMIT });
    if (!perContact.ok) throw new ConvexError({ code: "rate_limited", message: "Too many links to this number. Try again later." });
  }

  const token = randomKeySegment(32);
  const reference = `cap_${randomKeySegment(16)}`;
  const now = Date.now();
  const expiresAt = now + CAPTURE_LINK_HOURS * 60 * 60 * 1000;
  const sessionId = await ctx.db.insert("captureSessions", {
    clientId: args.clientId,
    tokenHash: await sha256Hex(token),
    reference,
    status: "pending",
    method: args.method,
    ...(contact ? { contact } : {}),
    language: args.language,
    prefill,
    ...(externalRef ? { externalRef } : {}),
    deliveryStatus: args.method === "link" ? "not_sent" : "pending",
    createdBy: args.actor.actorId,
    createdAt: now,
    expiresAt,
  });
  const link = captureLink(appUrl(), token);
  if (args.method !== "link") {
    await ctx.scheduler.runAfter(0, internalApi.capture.dispatch, { sessionId, message: captureMessage(args.language, client.name, link) });
  }
  await recordAudit(ctx, {
    actorId: args.actor.actorId,
    actorType: args.actor.actorType,
    action: "capture.link_created",
    targetType: "captureSession",
    targetId: sessionId,
    clientId: args.clientId,
    metadata: { method: args.method, language: args.language },
  });
  return { sessionId, reference, link, expiresAt };
}

export const create = mutation({
  args: {
    clientId: v.id("clients"),
    method: v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("link")),
    contact: v.optional(v.string()),
    language,
    prefill: v.optional(prefillValidator),
    externalRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, [...SEND_ROLES]);
    const { sessionId, link } = await createLink(ctx, { ...args, actor: { actorId: actor.userId, actorType: "client_user" } });
    return { sessionId, link };
  },
});

// -- The capture links API (http.ts: /v1/capture-links) ---------------------

// What the API shows of a link: never the token, prefilled ID number or
// date of birth.
async function apiView(ctx: QueryCtx | MutationCtx, row: Doc<"captureSessions">, now: number) {
  const verification = row.verificationId ? await ctx.db.get(row.verificationId) : null;
  return {
    id: row.reference ?? null,
    method: row.method,
    contact: row.contact ?? null,
    language: row.language,
    externalRef: row.externalRef ?? null,
    status: effectiveStatus(row, now),
    delivery: row.deliveryStatus,
    deliveryFailure: row.deliveryFailure ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    openedAt: row.openedAt ?? null,
    submittedAt: row.submittedAt ?? null,
    // The KYC check the customer's capture became.
    verificationId: verification?.reference ?? null,
  };
}

const methodValidator = v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("link"));

// POST /v1/capture-links. Test-mode keys get the checks and a sample
// response; nothing is stored or sent.
export const _createFromApi = internalMutation({
  args: {
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    method: methodValidator,
    contact: v.optional(v.string()),
    language,
    prefill: v.optional(prefillValidator),
    externalRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { clientId, apiKeyId, environment, ...link } = args;
    if (environment === "test") {
      const { contact, externalRef } = validateLink(link);
      const now = Date.now();
      return {
        id: `cap_test_${randomKeySegment(12)}`,
        link: null,
        method: link.method,
        contact: contact ?? null,
        language: link.language,
        externalRef: externalRef ?? null,
        status: "pending" as const,
        delivery: link.method === "link" ? ("not_sent" as const) : ("pending" as const),
        createdAt: now,
        expiresAt: now + CAPTURE_LINK_HOURS * 60 * 60 * 1000,
        sandbox: true,
      };
    }
    const created = await createLink(ctx, { clientId, ...link, actor: { actorId: apiKeyId, actorType: "client_api_key" } });
    const row = (await ctx.db.get(created.sessionId))!;
    return { ...(await apiView(ctx, row, Date.now())), link: created.link };
  },
});

async function byReference(ctx: QueryCtx | MutationCtx, clientId: Id<"clients">, reference: string) {
  return await ctx.db.query("captureSessions").withIndex("by_client_and_reference", (q) => q.eq("clientId", clientId).eq("reference", reference)).unique();
}

// GET /v1/capture-links: newest first; `before` is the createdAt of the last
// link seen. Links made before the API (no public id) are left out.
export const _listForApi = internalQuery({
  args: { clientId: v.id("clients"), limit: v.number(), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("captureSessions")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .filter((q) => q.and(q.neq(q.field("reference"), undefined), args.before === undefined ? true : q.lt(q.field("createdAt"), args.before)))
      .take(args.limit + 1);
    const page = rows.slice(0, args.limit);
    const now = Date.now();
    return {
      data: await Promise.all(page.map((row) => apiView(ctx, row, now))),
      nextCursor: rows.length > args.limit ? page[page.length - 1].createdAt : null,
    };
  },
});

export const _getForApi = internalQuery({
  args: { clientId: v.id("clients"), reference: v.string() },
  handler: async (ctx, args) => {
    const row = await byReference(ctx, args.clientId, args.reference);
    return row ? await apiView(ctx, row, Date.now()) : null;
  },
});

// DELETE /v1/capture-links/{id}: the link stops working. A submitted or
// expired link is left as it is.
export const _cancelFromApi = internalMutation({
  args: { clientId: v.id("clients"), apiKeyId: v.id("apiKeys"), reference: v.string() },
  handler: async (ctx, args) => {
    const row = await byReference(ctx, args.clientId, args.reference);
    if (!row) return null;
    const status = effectiveStatus(row, Date.now());
    if (status === "pending" || status === "opened") {
      await ctx.db.patch(row._id, { status: "cancelled", prefill: {} });
      await recordAudit(ctx, {
        actorId: args.apiKeyId,
        actorType: "client_api_key",
        action: "capture.link_cancelled",
        targetType: "captureSession",
        targetId: row._id,
        clientId: args.clientId,
      });
    }
    return await apiView(ctx, (await ctx.db.get(row._id))!, Date.now());
  },
});

export const dispatch = internalAction({
  args: { sessionId: v.id("captureSessions"), message: v.string() },
  handler: async (ctx, args) => {
    const session: Doc<"captureSessions"> | null = await ctx.runQuery(internalApi.capture.getInternal, { sessionId: args.sessionId });
    if (!session || !session.contact || session.method === "link" || session.deliveryStatus !== "pending") return;
    const outcome = await sendInvitation({ method: session.method, contact: session.contact }, args.message);
    await ctx.runMutation(internalApi.capture.markDelivery, {
      sessionId: args.sessionId,
      ...(outcome?.ok ? { deliveryStatus: "sent" as const, providerMessageId: outcome.sid } : { deliveryStatus: "failed" as const, reason: outcome ? outcome.reason : "No SMS or WhatsApp provider is set up." }),
    });
  },
});

export const getInternal = internalQuery({
  args: { sessionId: v.id("captureSessions") },
  handler: async (ctx, args) => await ctx.db.get(args.sessionId),
});

export const markDelivery = internalMutation({
  args: { sessionId: v.id("captureSessions"), deliveryStatus: v.union(v.literal("sent"), v.literal("failed")), providerMessageId: v.optional(v.string()), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      deliveryStatus: args.deliveryStatus,
      ...(args.providerMessageId ? { providerMessageId: args.providerMessageId } : {}),
      ...(args.reason ? { deliveryFailure: args.reason.slice(0, 200) } : {}),
    });
  },
});

export const list = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const rows = await ctx.db.query("captureSessions").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).order("desc").take(Math.min(Math.max(args.limit ?? 50, 1), 100));
    const now = Date.now();
    return Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        method: row.method,
        contact: row.contact ?? null,
        language: row.language,
        externalRef: row.externalRef ?? null,
        name: [row.prefill?.firstName, row.prefill?.lastName].filter(Boolean).join(" ") || null,
        status: effectiveStatus(row, now),
        deliveryStatus: row.deliveryStatus,
        deliveryFailure: row.deliveryFailure ?? null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        submittedAt: row.submittedAt ?? null,
        verificationId: row.verificationId ?? null,
        reference: row.verificationId ? (await ctx.db.get(row.verificationId))?.reference ?? null : null,
      })),
    );
  },
});

export const cancel = mutation({
  args: { clientId: v.id("clients"), sessionId: v.id("captureSessions") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, [...SEND_ROLES]);
    const row = await ctx.db.get(args.sessionId);
    if (!row || row.clientId !== args.clientId) throw new ConvexError({ code: "not_found", message: "Link not found." });
    if (row.status === "pending" || row.status === "opened") await ctx.db.patch(row._id, { status: "cancelled" });
  },
});

async function sessionByToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"captureSessions"> | null> {
  if (!isCaptureToken(token)) return null;
  const tokenHash = await sha256Hex(token);
  return await ctx.db.query("captureSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
}

// The customer's page (public, no account): what to show, never the ID
// number or other prefilled details beyond the first name.
export const session = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await sessionByToken(ctx, args.token);
    if (!row) return { status: "not_found" as const };
    const client = await ctx.db.get(row.clientId);
    return {
      status: effectiveStatus(row, Date.now()),
      clientName: client?.name ?? "Your provider",
      language: row.language,
      firstName: row.prefill?.firstName ?? null,
      needs: missingDetails(row.prefill),
    };
  },
});

// The customer's submission: becomes a KYC check (billed to the client).
export const submit = mutation({
  args: {
    token: v.string(),
    consent: v.literal(true),
    language,
    documentType: v.union(v.literal("id_card"), v.literal("passport"), v.literal("driving_license")),
    documentFrontBase64: v.string(),
    documentBackBase64: v.optional(v.string()),
    selfieBase64: v.string(),
    details: v.optional(prefillValidator),
  },
  handler: async (ctx, args) => {
    const row = await sessionByToken(ctx, args.token);
    if (!row) throw new ConvexError({ code: "not_found", message: "invalid" });
    const status = effectiveStatus(row, Date.now());
    if (status !== "pending" && status !== "opened") throw new ConvexError({ code: "unavailable", message: status });
    const limited = await rateLimiter.limit(ctx, "captureSubmitPerLink", { key: row._id, config: PER_LINK_LIMIT });
    if (!limited.ok) throw new ConvexError({ code: "rate_limited", message: "retry_later" });
    assertMediaSize({ documentFrontBase64: args.documentFrontBase64, documentBackBase64: args.documentBackBase64, selfieBase64: args.selfieBase64 });

    // What the client prefilled wins over what the customer typed.
    const details = { ...cleanPrefill(args.details), ...row.prefill };
    const missing = missingDetails(details);
    if (missing.length) invalid(`Missing: ${missing.join(", ")}`);
    const { id, reference } = await createIdpVerification(ctx, {
      clientId: row.clientId,
      input: {
        documentFrontBase64: args.documentFrontBase64,
        documentBackBase64: args.documentBackBase64,
        idNumber: details.idNumber!,
        firstName: details.firstName!,
        lastName: details.lastName!,
        dateOfBirth: details.dateOfBirth!,
        gender: details.gender!,
      },
      storedExtras: {
        documentType: args.documentType,
        capture: { sessionId: row._id, method: row.method, language: args.language, consentAt: Date.now() },
        ...(row.externalRef ? { externalRef: row.externalRef } : {}),
      },
      selfieBase64: args.selfieBase64,
      actor: { actorId: `capture:${row._id}`, actorType: "system" },
    });
    // The details now live on the verification (and its retention period).
    await ctx.db.patch(row._id, { status: "submitted", submittedAt: Date.now(), verificationId: id, prefill: {} });
    return { reference };
  },
});

// The page was opened (for the client's list).
export const markOpened = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await sessionByToken(ctx, args.token);
    if (row && row.status === "pending" && effectiveStatus(row, Date.now()) === "pending") await ctx.db.patch(row._id, { status: "opened", openedAt: Date.now() });
  },
});

// Hourly: links past their time become expired, and lose any prefilled
// details.
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    for (const status of ["pending", "opened"] as const) {
      const rows = await ctx.db.query("captureSessions").withIndex("by_status_and_expires", (q) => q.eq("status", status).lt("expiresAt", now)).take(200);
      for (const row of rows) {
        await ctx.db.patch(row._id, { status: "expired", prefill: {} });
        expired += 1;
      }
    }
    return { expired };
  },
});
