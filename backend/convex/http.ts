import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticateApiKey, type ApiKeyAuthResult } from "./apiKeys";
import { checkApiRateLimit } from "./lib/rateLimits";
import { mapTwilioDeliveryStatus, verifyTwilioSignature } from "./lib/twilio";

const http = httpRouter();


function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}


async function authenticateAndRateLimit(
  ctx: { runQuery: any; runMutation: any },
  request: Request,
): Promise<{ auth: Extract<ApiKeyAuthResult, { ok: true }> } | { response: Response }> {
  const auth = await authenticateApiKey(
    { runQuery: ctx.runQuery, runMutation: ctx.runMutation },
    request.headers.get("Authorization"),
  );
  if (auth.ok === false) {
    return { response: json({ error: auth.error }, auth.status) };
  }

  const rateLimit = await checkApiRateLimit(ctx, auth.plan, auth.apiKeyId);
  if (rateLimit.ok === false) {
    const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
    return {
      response: json(
        { error: "Rate limit exceeded" },
        429,
        { "Retry-After": String(retryAfterSeconds) },
      ),
    };
  }

  return { auth };
}

http.route({
  path: "/v1/verify/idp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) return authResult.response;
    const { auth } = authResult;

    let body: {
      livenessFramesBase64?: string;
      livenessMediaType?: "jpeg_frames" | "mp4";
      documentFrontBase64?: string;
      documentBackBase64?: string;
      idNumber?: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      gender?: string;
    };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const required = [
      "livenessFramesBase64",
      "livenessMediaType",
      "documentFrontBase64",
      "idNumber",
      "firstName",
      "lastName",
      "dateOfBirth",
      "gender",
    ] as const;
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0) {
      return json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
    }

 

    const balance = await ctx.runQuery(internal.creditLedger._getBalance, {
      clientId: auth.clientId,
    });
    const IDP_CREDIT_COST = 1;
    if (balance < IDP_CREDIT_COST) {
      return json({ error: "Insufficient credits" }, 402);
    }

    const { id, reference } = await ctx.runMutation(internal.verifications._create, {
      clientId: auth.clientId,
      type: "idp",
      creditsUsed: IDP_CREDIT_COST,
      input: {
        idNumber: body.idNumber,
        firstName: body.firstName,
        lastName: body.lastName,
      },
    });

    await ctx.scheduler.runAfter(0, internal.idp.processIdpVerification, {
      verificationId: id,
      clientId: auth.clientId,
      livenessFramesBase64: body.livenessFramesBase64!,
      livenessMediaType: body.livenessMediaType!,
      documentFrontBase64: body.documentFrontBase64!,
      documentBackBase64: body.documentBackBase64,
      idNumber: body.idNumber!,
      firstName: body.firstName!,
      lastName: body.lastName!,
      dateOfBirth: body.dateOfBirth!,
      gender: body.gender!,
    });

    return json({ id: reference, type: "idp", status: "queued" }, 202);
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
    const limitParam = url.searchParams.get("limit");
    const beforeParam = url.searchParams.get("before"); // cursor: createdAt of last item seen

    const validStatuses = ["queued", "processing", "completed", "failed"];
    const validTypes = ["idp", "kyb", "aml", "liveness"];
    if (status && !validStatuses.includes(status)) {
      return json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, 400);
    }
    if (type && !validTypes.includes(type)) {
      return json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }, 400);
    }

    const listResult = await ctx.runQuery(internal.verifications._listForClient, {
      clientId: auth.clientId,
      status: status as any,
      type: type as any,
      limit: limitParam ? Number(limitParam) : undefined,
      before: beforeParam ? Number(beforeParam) : undefined,
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
    if (!reference) {
      return json({ error: "Missing verification id" }, 400);
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
    const limitParam = url.searchParams.get("limit");
    const beforeParam = url.searchParams.get("before");

    const ledgerResult = await ctx.runQuery(internal.creditLedger._getLedgerHistory, {
      clientId: auth.clientId,
      limit: limitParam ? Number(limitParam) : undefined,
      before: beforeParam ? Number(beforeParam) : undefined,
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
    if (typeof body.providerMessageId !== "string" || !["completed", "failed"].includes(body.status)) return json({ error: "Invalid callback payload" }, 400);
    const result = await ctx.runMutation(internal.liveness.applyCallback, { providerMessageId: body.providerMessageId, status: body.status, verdict: body.verdict, result: body.result });
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
