import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticateApiKey, type ApiKeyAuthResult } from "./apiKeys";
import {
  checkApiRateLimit,
  checkAuthFailureBudget,
  checkClientRpmCap,
  recordAuthFailure,
} from "./lib/rateLimits";
import { parseApiKeyPrefix } from "./lib/crypto";
import { mapTwilioDeliveryStatus, verifyTwilioSignature } from "./lib/twilio";
import { MAX_MEDIA_BASE64_CHARS } from "./lib/verificationTypes";
import type { IdpInput } from "./verifications";

const http = httpRouter();


function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function rateLimited(retryAfterMs: number) {
  return json(
    { error: "Rate limit exceeded" },
    429,
    { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
  );
}

// Key for the failed-auth limiter: the caller's IP when the platform
// forwards one, otherwise the presented key prefix (or a shared bucket for
// unparseable headers). Only failures consume from it; it gates a request
// only once that key has failed repeatedly. The LAST X-Forwarded-For hop is
// used because a proxy appends the address it saw, while earlier hops are
// caller-controlled.
function authFailureKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim();
  if (ip) return `ip:${ip}`;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = parseApiKeyPrefix(header.replace(/^Bearer\s+/i, "").trim());
  return prefix ? `prefix:${prefix}` : "malformed";
}

async function authenticateAndRateLimit(
  ctx: ActionCtx,
  request: Request,
): Promise<{ auth: Extract<ApiKeyAuthResult, { ok: true }> } | { response: Response }> {
  // Pre-auth: callers that keep failing authentication are throttled before
  // any key lookup happens (brute force / prefix enumeration).
  const failureKey = authFailureKey(request);
  const budget = await checkAuthFailureBudget(ctx, failureKey);
  if (budget.ok === false) {
    return { response: rateLimited(budget.retryAfterMs) };
  }

  const auth = await authenticateApiKey(ctx, request.headers.get("Authorization"));
  if (auth.ok === false) {
    if (auth.status === 401) await recordAuthFailure(ctx, failureKey);
    return { response: json({ error: auth.error }, auth.status) };
  }

  const rateLimit = await checkApiRateLimit(ctx, auth.plan, auth.apiKeyId);
  if (rateLimit.ok === false) {
    return { response: rateLimited(rateLimit.retryAfterMs) };
  }
  // Per-client cap (clients.rpmCap) on top of the plan limit.
  const clientCap = await checkClientRpmCap(ctx, auth.clientId, auth.rpmCap);
  if (clientCap.ok === false) {
    return { response: rateLimited(clientCap.retryAfterMs) };
  }

  return { auth };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

const IDP_TEXT_FIELDS = ["idNumber", "firstName", "lastName", "dateOfBirth", "gender"] as const;
const IDP_REQUIRED_MEDIA = ["documentFrontBase64", "livenessFramesBase64"] as const;
const MAX_TEXT_LENGTH = 200;
const LIVENESS_MEDIA_TYPES = ["jpeg_frames", "mp4"] as const;

// Narrows the untrusted JSON body field by field; anything that doesn't
// match the contract is a 400 (413 for oversized media) before any row is
// written or any job scheduled.
function parseIdpBody(body: unknown): Parsed<IdpInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: json({ error: "Request body must be a JSON object" }, 400) };
  }
  const b = body as Record<string, unknown>;
  const isBlank = (value: unknown) =>
    value === undefined || value === null || (typeof value === "string" && !value.trim());

  const required = [...IDP_REQUIRED_MEDIA, "livenessMediaType", ...IDP_TEXT_FIELDS] as const;
  const missing = required.filter((field) => isBlank(b[field]));
  if (missing.length > 0) {
    return { ok: false, response: json({ error: `Missing required fields: ${missing.join(", ")}` }, 400) };
  }

  const invalid: string[] = [];
  for (const field of IDP_TEXT_FIELDS) {
    const value = b[field];
    if (typeof value !== "string" || value.trim().length > MAX_TEXT_LENGTH) invalid.push(field);
  }
  for (const field of IDP_REQUIRED_MEDIA) {
    if (typeof b[field] !== "string") invalid.push(field);
  }
  if (!isBlank(b.documentBackBase64) && typeof b.documentBackBase64 !== "string") {
    invalid.push("documentBackBase64");
  }
  if (!LIVENESS_MEDIA_TYPES.includes(b.livenessMediaType as (typeof LIVENESS_MEDIA_TYPES)[number])) {
    invalid.push("livenessMediaType");
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      response: json(
        {
          error: `Invalid fields: ${invalid.join(", ")}`,
          details: {
            text: `strings of at most ${MAX_TEXT_LENGTH} characters`,
            media: "base64 strings",
            livenessMediaType: LIVENESS_MEDIA_TYPES,
          },
        },
        400,
      ),
    };
  }

  const documentBackBase64 = isBlank(b.documentBackBase64) ? undefined : (b.documentBackBase64 as string);
  const oversized = (
    [
      ["documentFrontBase64", b.documentFrontBase64 as string],
      ["livenessFramesBase64", b.livenessFramesBase64 as string],
      ["documentBackBase64", documentBackBase64],
    ] as const
  )
    .filter(([, value]) => value !== undefined && value.length > MAX_MEDIA_BASE64_CHARS)
    .map(([name]) => name);
  if (oversized.length > 0) {
    return {
      ok: false,
      response: json(
        { error: `Media too large (max ${MAX_MEDIA_BASE64_CHARS} base64 characters each): ${oversized.join(", ")}` },
        413,
      ),
    };
  }

  return {
    ok: true,
    value: {
      documentFrontBase64: b.documentFrontBase64 as string,
      documentBackBase64,
      livenessFramesBase64: b.livenessFramesBase64 as string,
      livenessMediaType: b.livenessMediaType as IdpInput["livenessMediaType"],
      idNumber: (b.idNumber as string).trim(),
      firstName: (b.firstName as string).trim(),
      lastName: (b.lastName as string).trim(),
      dateOfBirth: (b.dateOfBirth as string).trim(),
      gender: (b.gender as string).trim(),
    },
  };
}

// Optional numeric query param; returns a 400 response when present but not
// a finite number in range.
function parseNumberParam(
  url: URL,
  name: string,
  opts: { integer?: boolean; min: number; max: number },
): Parsed<number | undefined> {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return { ok: true, value: undefined };
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    (opts.integer && !Number.isInteger(value)) ||
    value < opts.min ||
    value > opts.max
  ) {
    return {
      ok: false,
      response: json({ error: `Invalid ${name}. Must be a${opts.integer ? "n integer" : " number"} between ${opts.min} and ${opts.max}.` }, 400),
    };
  }
  return { ok: true, value };
}

http.route({
  path: "/v1/verify/idp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = parseIdpBody(body);
    if (!parsed.ok) return parsed.response;

    // Credit check, insert and scheduling happen in one mutation. Test-mode
    // keys get a deterministic sandbox result (verdict "pass", status
    // "completed", no provider calls, 0 credits).
    let created: { reference: string; status: "queued" | "completed"; verdict: "pass" | null; sandbox: boolean };
    try {
      created = await ctx.runMutation(internal.verifications._createIdpFromApi, {
        clientId: auth.clientId,
        apiKeyId: auth.apiKeyId,
        environment: auth.environment,
        input: parsed.value,
      });
    } catch (err) {
      if (err instanceof ConvexError) {
        const data = err.data as { code?: string; message?: string } | undefined;
        if (data?.code === "insufficient_credits") return json({ error: "Insufficient credits" }, 402);
        if (data?.code === "invalid_argument") return json({ error: data.message ?? "Invalid request" }, 400);
        if (data?.code === "payload_too_large") return json({ error: data.message ?? "Payload too large" }, 413);
        if (data?.code === "forbidden") return json({ error: "Account is not active" }, 403);
      }
      throw err;
    }

    return json(
      {
        id: created.reference,
        type: "idp",
        status: created.status,
        ...(created.sandbox ? { verdict: created.verdict, sandbox: true } : {}),
      },
      202,
    );
  }),
});


http.route({
  path: "/v1/verify",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;

    const validStatuses = ["queued", "processing", "completed", "failed"] as const;
    const validTypes = ["idp", "kyb", "aml", "liveness", "kyi"] as const;
    if (status && !validStatuses.includes(status as (typeof validStatuses)[number])) {
      return json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, 400);
    }
    if (type && !validTypes.includes(type as (typeof validTypes)[number])) {
      return json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }, 400);
    }
    const limit = parseNumberParam(url, "limit", { integer: true, min: 1, max: 100 });
    if (!limit.ok) return limit.response;
    // cursor: createdAt of the last item seen
    const before = parseNumberParam(url, "before", { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!before.ok) return before.response;

    const listResult = await ctx.runQuery(internal.verifications._listForClient, {
      clientId: auth.clientId,
      status: status as (typeof validStatuses)[number] | undefined,
      type: type as (typeof validTypes)[number] | undefined,
      limit: limit.value,
      before: before.value,
    });

    return json({
      data: listResult.records.map((r) => ({
        id: r.reference,
        type: r.type,
        status: r.status,
        verdict: r.verdict ?? null,
        confidence: r.confidence ?? null,
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? null,
      })),
      nextCursor: listResult.nextCursor,
    });
  }),
});

http.route({
  pathPrefix: "/v1/verify/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    const url = new URL(request.url);
    const reference = url.pathname.split("/").pop();
    if (!reference || !/^[A-Za-z0-9_-]{1,128}$/.test(reference)) {
      return json({ error: "Missing or invalid verification id" }, 400);
    }

    const record = await ctx.runQuery(internal.verifications._getByReferenceForClient, {
      reference,
      clientId: auth.clientId,
    });

    if (!record) {
      return json({ error: "Verification not found" }, 404);
    }

    return json({
      id: record.reference,
      type: record.type,
      status: record.status,
      verdict: record.verdict ?? null,
      confidence: record.confidence ?? null,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? null,
      failureReason: record.failureReason ?? null,
      sandbox: (record.input as { sandbox?: unknown } | undefined)?.sandbox === true,
    });
  }),
});

// GET /v1/credits — Section 8.1: "Current credit balance and usage."
http.route({
  path: "/v1/credits",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    const balance = await ctx.runQuery(internal.creditLedger._getBalance, {
      clientId: auth.clientId,
    });

    return json({ balance });
  }),
});


http.route({
  path: "/v1/credits/ledger",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    const url = new URL(request.url);
    const limit = parseNumberParam(url, "limit", { integer: true, min: 1, max: 100 });
    if (!limit.ok) return limit.response;
    const before = parseNumberParam(url, "before", { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!before.ok) return before.response;

    const ledgerResult = await ctx.runQuery(internal.creditLedger._getLedgerHistory, {
      clientId: auth.clientId,
      limit: limit.value,
      before: before.value,
    });

    return json({
      data: ledgerResult.entries.map((r) => ({
        type: r.type,
        amount: r.amount,
        reason: r.reason,
        verificationId: r.verificationId ?? null,
        createdAt: r.createdAt,
      })),
      nextCursor: ledgerResult.nextCursor,
    });
  }),
});

async function validHmac(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = signature.replace(/^sha256=/, "").toLowerCase();
  const bytes = new Uint8Array(expected.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  return bytes.length === 32 && await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(rawBody));
}

http.route({
  path: "/webhooks/liveness/result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const secret = process.env.LIVENESS_CALLBACK_SECRET;
    if (!secret || !(await validHmac(rawBody, request.headers.get("X-Liveness-Signature"), secret))) return json({ error: "Invalid signature" }, 401);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON body" }, 400); }
    if (!body || typeof body !== "object" || typeof body.providerMessageId !== "string" || !["completed", "failed"].includes(body.status)) return json({ error: "Invalid callback payload" }, 400);
    // verdict is optional (missing fails closed to review); a present one must be known.
    if (body.verdict != null && !["pass", "review", "reject"].includes(body.verdict)) return json({ error: "Invalid verdict" }, 400);
    const result = await ctx.runMutation(internal.liveness.applyCallback, { providerMessageId: body.providerMessageId, status: body.status, verdict: body.verdict ?? undefined, result: body.result });
    return json(result, result.accepted ? 200 : 404);
  }),
});

http.route({
  path: "/webhooks/liveness/delivery",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const params = new URLSearchParams(rawBody);
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = request.headers.get("X-Twilio-Signature");
    if (!authToken || !(await verifyTwilioSignature(request.url, params, signature, authToken))) return json({ error: "Invalid Twilio signature" }, 401);
    const providerMessageId = params.get("MessageSid");
    if (!providerMessageId) return json({ error: "Missing MessageSid" }, 400);
    const deliveryStatus = mapTwilioDeliveryStatus(params.get("MessageStatus"));
    const result = await ctx.runMutation(internal.liveness.applyDeliveryCallback, { providerMessageId, deliveryStatus, reason: params.get("ErrorMessage") ?? undefined });
    return json(result, result.accepted ? 200 : 404);
  }),
});

export default http;
