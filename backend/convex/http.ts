import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticateApiKey, keyAllowsRoute, scopeForRoute, type ApiKeyAuthResult } from "./apiKeys";
import { ipAllowed } from "./lib/clientSettings";
import {
  checkApiRateLimit,
  checkAuthFailureBudget,
  checkClientRpmCap,
  recordAuthFailure,
} from "./lib/rateLimits";
import { parseApiKeyPrefix } from "./lib/crypto";
import { mapTwilioDeliveryStatus, verifyTwilioSignature } from "./lib/twilio";
import { callbackTokenMatches, mapAfricasTalkingDeliveryStatus } from "./lib/africasTalking";
import { MAX_MEDIA_BASE64_CHARS } from "./lib/verificationTypes";
import type { IdpInput } from "./verifications";
import { MAX_ALIASES, MAX_COUNTRY_LENGTH, MAX_IDENTIFIER_LENGTH, MAX_SUBJECT_NAME_LENGTH, type AmlSubjectDetails } from "./aml";
import { MAX_EXTERNAL_REF_LENGTH } from "./lib/amlMonitoringStore";
import { paystackSecret, validPaystackSignature } from "./lib/paystack";

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
function requestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

function authFailureKey(request: Request): string {
  const ip = requestIp(request);
  if (ip) return `ip:${ip}`;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = parseApiKeyPrefix(header.replace(/^Bearer\s+/i, "").trim());
  return prefix ? `prefix:${prefix}` : "malformed";
}

async function authenticateAndRateLimit(
  ctx: ActionCtx,
  request: Request,
): Promise<{ auth: AuthenticatedKey } | { response: Response; auth?: AuthenticatedKey }> {
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
    return { response: rateLimited(rateLimit.retryAfterMs), auth };
  }
  // Per-client cap (clients.rpmCap) on top of the plan limit.
  const clientCap = await checkClientRpmCap(ctx, auth.clientId, auth.rpmCap);
  if (clientCap.ok === false) {
    return { response: rateLimited(clientCap.retryAfterMs), auth };
  }

  return { auth };
}

type AuthenticatedKey = Extract<ApiKeyAuthResult, { ok: true }>;

// Records an error response a client received, for the Back Office client
// health page. Unattributable failures (bad or missing keys) are not logged.
// Logging must never change or break the response.
async function logClientError(ctx: ActionCtx, auth: AuthenticatedKey, route: string, status: number) {
  if (status < 400) return;
  try {
    await ctx.runMutation(internal.backOfficeClients._logApiError, {
      clientId: auth.clientId,
      apiKeyId: auth.apiKeyId,
      environment: auth.environment,
      route,
      status,
    });
  } catch (error) {
    console.error("[http] could not log API error", error instanceof Error ? error.message : "");
  }
}

// An API-key route: authenticates and rate-limits, runs the handler, and logs
// any 4xx/5xx the client gets (an unhandled error is logged as a 500).
function apiAction(route: string, handler: (ctx: ActionCtx, request: Request, auth: AuthenticatedKey) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const authResult = await authenticateAndRateLimit(ctx, request);
    if ("response" in authResult) {
      if (authResult.auth) await logClientError(ctx, authResult.auth, route, authResult.response.status);
      return authResult.response;
    }
    const { auth } = authResult;
    // The key's scopes (Settings → Developers) and, when the client applies
    // it to the API, their IP allowlist (Settings → Security).
    if (!keyAllowsRoute(auth.scopes, route)) {
      const denied = json({ error: `This API key can't call ${route}. Give it the "${scopeForRoute(route)}" scope or use another key.` }, 403);
      await logClientError(ctx, auth, route, 403);
      return denied;
    }
    const ipRules: string[] = await ctx.runQuery(internal.apiKeys._apiIpRules, { clientId: auth.clientId });
    if (ipRules.length > 0 && !ipAllowed(requestIp(request), ipRules)) {
      const denied = json({ error: "Requests from this IP address aren't allowed for your organization." }, 403);
      await logClientError(ctx, auth, route, 403);
      return denied;
    }
    let response: Response;
    try {
      response = await handler(ctx, request, auth);
    } catch (error) {
      await logClientError(ctx, auth, route, 500);
      throw error;
    }
    await logClientError(ctx, auth, route, response.status);
    return response;
  });
}

type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

type Created = {
  reference: string;
  status: "queued" | "completed";
  verdict: "pass" | null;
  sandbox: boolean;
  // AML only: the monitored subject's id when the request asked for monitoring.
  monitoringId?: string | null;
};

// Runs a create mutation and maps its known ConvexError codes to HTTP
// statuses; returns 202 with the client-facing id on success.
async function createdResponse(type: string, create: () => Promise<Created>): Promise<Response> {
  let created: Created;
  try {
    created = await create();
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
      type,
      status: created.status,
      ...(created.sandbox ? { verdict: created.verdict, sandbox: true } : {}),
      ...(created.monitoringId !== undefined ? { monitoringId: created.monitoringId } : {}),
    },
    202,
  );
}

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

// Client-facing view of a completed AML result: the reason, which sources
// were screened, and the matches without internal Convex ids.
function amlScreeningSummary(result: unknown) {
  const r = (result ?? {}) as {
    reason?: unknown;
    matches?: Array<Record<string, unknown>>;
    coverage?: { checkedSources?: Array<{ sourceKey?: unknown; stale?: unknown }>; openSanctions?: unknown };
    categories?: unknown;
  };
  return {
    reason: typeof r.reason === "string" ? r.reason : null,
    // Hits per category (sanctions, pep, special_interest, fitness_probity,
    // adverse_media, insolvency) and the most severe PEP class; null on
    // screenings from before categories existed.
    categories: r.categories && typeof r.categories === "object" ? r.categories : null,
    sources: {
      watchlists: (r.coverage?.checkedSources ?? []).map((source) => ({
        source: source.sourceKey ?? null,
        stale: source.stale === true,
      })),
      openSanctions: typeof r.coverage?.openSanctions === "string" ? r.coverage.openSanctions : null,
    },
    matches: (Array.isArray(r.matches) ? r.matches : []).map((match) => ({
      source: match.source ?? null,
      sourceRecordId: match.sourceRecordId ?? null,
      entityName: match.entityName ?? null,
      program: match.program ?? null,
      matchScore: match.matchScore ?? null,
      riskLevel: match.riskLevel ?? null,
      matchedCountry: match.matchedCountry ?? null,
      topics: Array.isArray(match.topics) ? match.topics : [],
      categories: Array.isArray(match.categories) ? match.categories : [],
      pepClass: typeof match.pepClass === "number" ? match.pepClass : null,
      birthDateMatch: typeof match.birthDateMatch === "string" ? match.birthDateMatch : null,
    })),
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
  handler: apiAction("POST /v1/verify/idp", async (ctx, request, auth) => {

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
    return createdResponse("idp", () =>
      ctx.runMutation(internal.verifications._createIdpFromApi, {
        clientId: auth.clientId,
        apiKeyId: auth.apiKeyId,
        environment: auth.environment,
        input: parsed.value,
      }),
    );
  }),
});

type AmlBody = AmlSubjectDetails & {
  subjectName: string;
  entityType: "individual" | "entity";
  country?: string;
  monitor?: boolean;
  externalRef?: string;
};
const AML_ENTITY_TYPES = ["individual", "entity"] as const;
// Optional string fields and their maximum lengths. Whether each applies to
// the entity type, and the date format, are checked in aml.normalizeAmlRequest.
const AML_OPTIONAL_TEXT: Array<[keyof AmlSubjectDetails, number]> = [
  ["dateOfBirth", 10],
  ["nationality", MAX_COUNTRY_LENGTH],
  ["idNumber", MAX_IDENTIFIER_LENGTH],
  ["registrationNumber", MAX_IDENTIFIER_LENGTH],
  ["jurisdiction", MAX_COUNTRY_LENGTH],
];

function parseAmlBody(body: unknown): Parsed<AmlBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: json({ error: "Request body must be a JSON object" }, 400) };
  }
  const b = body as Record<string, unknown>;
  const missing = (["subjectName", "entityType"] as const).filter(
    (field) => typeof b[field] !== "string" || !(b[field] as string).trim(),
  );
  if (missing.length > 0) {
    return { ok: false, response: json({ error: `Missing required fields: ${missing.join(", ")}` }, 400) };
  }
  const invalid: string[] = [];
  if ((b.subjectName as string).trim().length > MAX_SUBJECT_NAME_LENGTH) invalid.push("subjectName");
  if (!AML_ENTITY_TYPES.includes(b.entityType as AmlBody["entityType"])) invalid.push("entityType");
  if (
    b.country !== undefined &&
    b.country !== null &&
    (typeof b.country !== "string" || b.country.trim().length > MAX_COUNTRY_LENGTH)
  ) {
    invalid.push("country");
  }
  for (const [field, max] of AML_OPTIONAL_TEXT) {
    const value = b[field];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > max)) invalid.push(field);
  }
  if (
    b.aliases !== undefined &&
    b.aliases !== null &&
    (!Array.isArray(b.aliases) ||
      b.aliases.length > MAX_ALIASES ||
      b.aliases.some((alias) => typeof alias !== "string" || alias.trim().length > MAX_SUBJECT_NAME_LENGTH))
  ) {
    invalid.push("aliases");
  }
  if (b.monitor !== undefined && b.monitor !== null && typeof b.monitor !== "boolean") invalid.push("monitor");
  if (
    b.externalRef !== undefined &&
    b.externalRef !== null &&
    (typeof b.externalRef !== "string" || b.externalRef.trim().length > MAX_EXTERNAL_REF_LENGTH)
  ) {
    invalid.push("externalRef");
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      response: json(
        {
          error: `Invalid fields: ${invalid.join(", ")}`,
          details: {
            subjectName: `string of at most ${MAX_SUBJECT_NAME_LENGTH} characters`,
            entityType: AML_ENTITY_TYPES,
            country: `optional string of at most ${MAX_COUNTRY_LENGTH} characters (ISO code or name)`,
            aliases: `optional array of at most ${MAX_ALIASES} names`,
            dateOfBirth: "optional, individuals only: YYYY, YYYY-MM or YYYY-MM-DD",
            nationality: "optional, individuals only: ISO code or name",
            idNumber: `optional, individuals only: national ID or passport number, at most ${MAX_IDENTIFIER_LENGTH} characters`,
            registrationNumber: `optional, entities only: company registration number, at most ${MAX_IDENTIFIER_LENGTH} characters`,
            jurisdiction: "optional, entities only: country of incorporation (ISO code or name)",
            monitor: "optional boolean: keep re-screening this subject daily and alert on new hits",
            externalRef: `optional, with monitor: your customer id, at most ${MAX_EXTERNAL_REF_LENGTH} characters`,
          },
        },
        400,
      ),
    };
  }
  const country = typeof b.country === "string" && b.country.trim() ? b.country.trim() : undefined;
  const details: AmlSubjectDetails = {};
  for (const [field] of AML_OPTIONAL_TEXT) {
    const value = b[field];
    if (typeof value === "string" && value.trim()) details[field] = value.trim() as never;
  }
  if (Array.isArray(b.aliases) && b.aliases.length > 0) details.aliases = (b.aliases as string[]).map((alias) => alias.trim());
  const monitoring = {
    ...(b.monitor === true ? { monitor: true } : {}),
    ...(typeof b.externalRef === "string" && b.externalRef.trim() ? { externalRef: b.externalRef.trim() } : {}),
  };
  return {
    ok: true,
    value: {
      subjectName: (b.subjectName as string).trim(),
      entityType: b.entityType as AmlBody["entityType"],
      country,
      ...details,
      ...monitoring,
    },
  };
}

http.route({
  path: "/v1/verify/aml",
  method: "POST",
  handler: apiAction("POST /v1/verify/aml", async (ctx, request, auth) => {

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = parseAmlBody(body);
    if (!parsed.ok) return parsed.response;

    return createdResponse("aml", () =>
      ctx.runMutation(internal.aml._createFromApi, {
        clientId: auth.clientId,
        apiKeyId: auth.apiKeyId,
        environment: auth.environment,
        ...parsed.value,
      }),
    );
  }),
});


// ── Transaction monitoring ────────────────────────────────────────────────
// POST /v1/transactions: up to 500 of a customer's transactions per call,
// checked against the monitoring rules (transactions.ts). Idempotent per
// externalId. Test keys validate without storing.
http.route({
  path: "/v1/transactions",
  method: "POST",
  handler: apiAction("POST /v1/transactions", async (ctx, request, auth) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const list = body && typeof body === "object" && !Array.isArray(body) ? (body as { transactions?: unknown }).transactions : undefined;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500 || list.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return json(
        {
          error: "Send { transactions: [...] } with 1 to 500 transactions.",
          details: {
            externalId: "required: your unique id for the transaction",
            customerRef: "required: your customer id, or the Sentinel reference of their KYC or AML check",
            occurredAt: "required: ISO 8601 date-time",
            amount: "required: positive number",
            currency: "KES (default) or USD",
            direction: "required: in or out",
            channel: "mpesa, cash, bank_transfer, rtgs, swift, card, cheque or other",
            counterpartyName: "optional, screened against sanctions and watch lists",
            counterpartyCountry: "optional: 2-letter ISO code",
            counterpartyAccount: "optional",
            narration: "optional",
          },
        },
        400,
      );
    }
    const keys = ["externalId", "customerRef", "occurredAt", "amount", "currency", "direction", "channel", "counterpartyName", "counterpartyCountry", "counterpartyAccount", "narration"] as const;
    const transactions = (list as Array<Record<string, unknown>>).map((item) => Object.fromEntries(keys.filter((key) => item[key] !== undefined && item[key] !== null).map((key) => [key, item[key]])));
    const result = await ctx.runMutation((internal as any).transactions._ingestFromApi, { clientId: auth.clientId, apiKeyId: auth.apiKeyId, environment: auth.environment, transactions });
    return json(result, 202);
  }),
});

// ── IDP: document verification ─────────────────────────────────────────────
// POST /v1/verify/document: an identity document or a proof of address,
// verified by Claude vision, AWS Textract OCR and forensic checks.

const DOCUMENT_TEXT_FIELDS = ["expectedName", "expectedAddress", "expectedDateOfBirth", "expectedKraPin", "externalRef"] as const;

http.route({
  path: "/v1/verify/document",
  method: "POST",
  handler: apiAction("POST /v1/verify/document", async (ctx, request, auth) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Request body must be a JSON object" }, 400);
    const b = body as Record<string, unknown>;
    const invalid: string[] = [];
    if (b.documentKind !== "identity" && b.documentKind !== "proof_of_address" && b.documentKind !== "kra_pin") invalid.push("documentKind");
    if (typeof b.documentFrontBase64 !== "string" || !b.documentFrontBase64.trim()) invalid.push("documentFrontBase64");
    if (b.documentBackBase64 !== undefined && b.documentBackBase64 !== null && typeof b.documentBackBase64 !== "string") invalid.push("documentBackBase64");
    for (const field of DOCUMENT_TEXT_FIELDS) {
      if (b[field] !== undefined && b[field] !== null && typeof b[field] !== "string") invalid.push(field);
    }
    if (b.maxDocumentAgeDays !== undefined && b.maxDocumentAgeDays !== null && typeof b.maxDocumentAgeDays !== "number") invalid.push("maxDocumentAgeDays");
    if (invalid.length) {
      return json(
        {
          error: `Invalid fields: ${invalid.join(", ")}`,
          details: {
            documentKind: ["identity", "proof_of_address", "kra_pin"],
            documentFrontBase64: "required: base64 JPEG, PNG, WebP or PDF",
            documentBackBase64: "optional, identity documents only: the back of the card",
            expectedName: "optional: name to match",
            expectedAddress: "optional, proof of address: declared address to match",
            expectedDateOfBirth: "optional, identity documents: YYYY-MM-DD to match",
            expectedKraPin: "optional, KRA PIN certificates: the declared PIN to match",
            maxDocumentAgeDays: "optional, proof of address: oldest acceptable issue date in days (default 90)",
            externalRef: "optional: your reference",
          },
        },
        400,
      );
    }
    const optionalText = (field: (typeof DOCUMENT_TEXT_FIELDS)[number]) => (typeof b[field] === "string" && (b[field] as string).trim() ? (b[field] as string) : undefined);
    return createdResponse("document", () =>
      ctx.runMutation(internal.documents._createFromApi, {
        clientId: auth.clientId,
        apiKeyId: auth.apiKeyId,
        environment: auth.environment,
        documentKind: b.documentKind as "identity" | "proof_of_address" | "kra_pin",
        documentFrontBase64: b.documentFrontBase64 as string,
        ...(typeof b.documentBackBase64 === "string" && b.documentBackBase64.trim() ? { documentBackBase64: b.documentBackBase64 } : {}),
        ...(optionalText("expectedName") ? { expectedName: optionalText("expectedName") } : {}),
        ...(optionalText("expectedAddress") ? { expectedAddress: optionalText("expectedAddress") } : {}),
        ...(optionalText("expectedDateOfBirth") ? { expectedDateOfBirth: optionalText("expectedDateOfBirth") } : {}),
        ...(optionalText("expectedKraPin") ? { expectedKraPin: optionalText("expectedKraPin") } : {}),
        ...(optionalText("externalRef") ? { externalRef: optionalText("externalRef") } : {}),
        ...(typeof b.maxDocumentAgeDays === "number" ? { maxDocumentAgeDays: b.maxDocumentAgeDays } : {}),
      }),
    );
  }),
});

// Client-facing view of a completed document verification.
function documentSummary(result: unknown) {
  const r = (result ?? {}) as Record<string, unknown>;
  return {
    reason: typeof r.reason === "string" ? r.reason : null,
    riskScore: typeof r.riskScore === "number" ? r.riskScore : null,
    documentKind: r.documentKind ?? null,
    identity: r.identity ?? null,
    proofOfAddress: r.proofOfAddress ?? null,
    kraPin: r.kraPin ?? null,
    checks: Array.isArray(r.checks) ? r.checks : [],
    flags: Array.isArray(r.flags) ? r.flags : [],
    ocr: r.ocr ?? null,
    forensics: r.forensics ?? null,
  };
}

// ── Ongoing AML monitoring ──────────────────────────────────────────────────
// Subjects are enrolled with POST /v1/verify/aml { monitor: true }. Alerts
// arrive as AML verifications (webhook event "sentinel.monitoring.alert").

http.route({
  path: "/v1/monitoring/subjects",
  method: "GET",
  handler: apiAction("GET /v1/monitoring/subjects", async (ctx, request, auth) => {
    const url = new URL(request.url);
    const limit = parseNumberParam(url, "limit", { integer: true, min: 1, max: 100 });
    if (!limit.ok) return limit.response;
    const before = parseNumberParam(url, "before", { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!before.ok) return before.response;
    const result = await ctx.runQuery(internal.amlMonitoring._listForApi, {
      clientId: auth.clientId,
      limit: limit.value ?? 50,
      before: before.value,
    });
    return json(result);
  }),
});

function monitoringReference(request: Request): string | null {
  const reference = new URL(request.url).pathname.split("/").pop();
  return reference && /^mon_[A-Za-z0-9]{1,64}$/.test(reference) ? reference : null;
}

http.route({
  pathPrefix: "/v1/monitoring/subjects/",
  method: "GET",
  handler: apiAction("GET /v1/monitoring/subjects/*", async (ctx, request, auth) => {
    const reference = monitoringReference(request);
    if (!reference) return json({ error: "Missing or invalid monitored subject id" }, 400);
    const subject = await ctx.runQuery(internal.amlMonitoring._getForApi, { clientId: auth.clientId, reference });
    return subject ? json(subject) : json({ error: "Monitored subject not found" }, 404);
  }),
});

http.route({
  pathPrefix: "/v1/monitoring/subjects/",
  method: "DELETE",
  handler: apiAction("DELETE /v1/monitoring/subjects/*", async (ctx, request, auth) => {
    const reference = monitoringReference(request);
    if (!reference) return json({ error: "Missing or invalid monitored subject id" }, 400);
    const removed = await ctx.runMutation(internal.amlMonitoring._removeFromApi, {
      clientId: auth.clientId,
      apiKeyId: auth.apiKeyId,
      reference,
    });
    return removed ? json({ id: reference, status: "removed" }) : json({ error: "Monitored subject not found" }, 404);
  }),
});

http.route({
  path: "/v1/verify",
  method: "GET",
  handler: apiAction("GET /v1/verify", async (ctx, request, auth) => {

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;

    const validStatuses = ["queued", "processing", "completed", "failed"] as const;
    const validTypes = ["idp", "kyb", "aml", "liveness", "kyi", "document"] as const;
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
  handler: apiAction("GET /v1/verify/*", async (ctx, request, auth) => {

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
      ...(record.type === "aml" && record.status === "completed" ? { screening: amlScreeningSummary(record.result) } : {}),
      ...(record.type === "document" && record.status === "completed" ? { document: documentSummary(record.result) } : {}),
    });
  }),
});

// GET /v1/credits — Section 8.1: "Current credit balance and usage."
http.route({
  path: "/v1/credits",
  method: "GET",
  handler: apiAction("GET /v1/credits", async (ctx, request, auth) => {

    // `balance` stays in credits for existing integrations; 1 credit = $0.01.
    const summary = await ctx.runQuery(internal.creditLedger._getCreditSummary, {
      clientId: auth.clientId,
    });

    return json(summary);
  }),
});


http.route({
  path: "/v1/credits/ledger",
  method: "GET",
  handler: apiAction("GET /v1/credits/ledger", async (ctx, request, auth) => {

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

// Africa's Talking SMS delivery reports. Set the callback URL in the Africa's
// Talking dashboard (SMS → Callback URLs → Delivery Reports) to
// https://<deployment>.convex.site/webhooks/liveness/delivery/africastalking?token=<AFRICASTALKING_CALLBACK_TOKEN>.
// Reports are not signed, so the token is the only proof of origin.
http.route({
  path: "/webhooks/liveness/delivery/africastalking",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token");
    if (!callbackTokenMatches(token, process.env.AFRICASTALKING_CALLBACK_TOKEN)) return json({ error: "Invalid callback token" }, 401);
    const params = new URLSearchParams(await request.text());
    const providerMessageId = params.get("id");
    if (!providerMessageId) return json({ error: "Missing id" }, 400);
    const deliveryStatus = mapAfricasTalkingDeliveryStatus(params.get("status"));
    const result = await ctx.runMutation(internal.liveness.applyDeliveryCallback, { providerMessageId, deliveryStatus, reason: params.get("failureReason") ?? undefined });
    return json(result, result.accepted ? 200 : 404);
  }),
});

// MetaMap GovChecks callback for Kenya BRS lookups. The URL carries a
// one-time random token per lookup (only its hash is stored); callbacks
// aren't signed, so the token is the proof of origin.
http.route({
  path: "/webhooks/metamap/brs",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token");
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return json({ error: "Invalid callback token" }, 401);
    const raw = await request.text();
    if (raw.length > 256 * 1024) return json({ error: "Body too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const result = await ctx.runMutation((internal as any).kyb.receiveRegistryCallback, { token, body });
    return json(result, result.accepted ? 200 : 404);
  }),
});

// Paystack webhooks (Dashboard → Settings → API Keys & Webhooks → Webhook
// URL: https://<deployment>.convex.site/webhooks/paystack). Signed with the
// secret key (x-paystack-signature, HMAC-SHA512). A successful charge is
// verified with Paystack's API before the invoice is settled (billing.ts).
http.route({
  path: "/webhooks/paystack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = paystackSecret();
    if (!secret) return json({ error: "Paystack is not configured" }, 503);
    const raw = await request.text();
    if (raw.length > 256 * 1024) return json({ error: "Body too large" }, 413);
    if (!(await validPaystackSignature(raw, request.headers.get("x-paystack-signature"), secret))) return json({ error: "Invalid signature" }, 401);
    let event: { event?: string; data?: { reference?: string } };
    try {
      event = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const reference = event.data?.reference;
    if ((event.event === "charge.success" || event.event === "charge.failed") && typeof reference === "string" && reference.startsWith("snt-")) {
      await ctx.scheduler.runAfter(0, (internal as any).billing.verifyAndSettle, { reference });
    }
    return json({ received: true });
  }),
});

export default http;
