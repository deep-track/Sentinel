import { checkOutboundUrl } from "./urlSafety";

export const WEBHOOK_RETRY_SCHEDULE_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1;

const WEBHOOK_TIMEOUT_MS = 10_000;

// After this many failed attempts in a row an endpoint is paused and the
// client is alerted (it resumes from Settings → Developers).
export const PAUSE_AFTER_CONSECUTIVE_FAILURES = 20;
// A rotated secret becomes the signing secret after this long.
export const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_ENDPOINTS_PER_CLIENT = 5;
export const MAX_CUSTOM_HEADERS = 5;

// Event types an endpoint can subscribe to. scan.complete and
// monitoring.alert are what every endpoint got before subscriptions
// existed; the others are opt-in.
export const WEBHOOK_EVENT_TYPES = [
  { value: "sentinel.scan.complete", label: "Check completed or failed", detail: "Every check's result. Also sent again with the final verdict when a review is decided, unless the endpoint subscribes to Review decided." },
  { value: "sentinel.monitoring.alert", label: "AML monitoring alert", detail: "Ongoing monitoring found a new or more severe hit." },
  { value: "sentinel.review.decided", label: "Review decided", detail: "A person approved or rejected a case, with who decided and the reason." },
  { value: "sentinel.credits.low", label: "Low credits", detail: "The credit balance fell to your warning level." },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENT_TYPES)[number]["value"] | "sentinel.test";
export const DEFAULT_ENDPOINT_EVENTS: WebhookEvent[] = ["sentinel.scan.complete", "sentinel.monitoring.alert"];

export const WEBHOOK_PRODUCTS = [
  { value: "kyc", label: "KYC (identity)" },
  { value: "aml", label: "AML screening" },
  { value: "idp", label: "Documents (IDP)" },
  { value: "kyb", label: "Business (KYB)" },
  { value: "liveness", label: "Liveness" },
] as const;

// payload
export type WebhookPayload = {
  // "sentinel.monitoring.alert" for alerts raised by ongoing AML monitoring.
  event: WebhookEvent;
  scan_id: string;
  status: "PASS" | "REVIEW" | "REJECT" | "FAILED";
  timestamp: string; // ISO 8601
  result: unknown;
  // Which product the check belongs to (absent on events not about a check).
  product?: string | null;
  // sentinel.review.decided only.
  review?: { decision: "approved" | "rejected"; decided_by: "client" | "deeptrack"; reason: string | null; decided_at: string };
  // sentinel.credits.low only.
  credits?: { balance: number; warning_level: number };
};

// Whether an endpoint gets this delivery.
export function endpointWants(
  endpoint: { status: string; events: string[]; products?: string[]; environment: "live" | "test" | "all" },
  delivery: { event: string; product: string | null; sandbox: boolean },
): boolean {
  if (delivery.event === "sentinel.test") return true;
  if (!endpoint.events.includes(delivery.event)) return false;
  if (delivery.product && endpoint.products && !endpoint.products.includes(delivery.product)) return false;
  if (delivery.product) {
    if (endpoint.environment === "live" && delivery.sandbox) return false;
    if (endpoint.environment === "test" && !delivery.sandbox) return false;
  }
  return true;
}

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADERS = /^(content-type|content-length|host|user-agent|x-sentinel-.*)$/i;

// Checks custom headers an endpoint sends (e.g. an auth token).
export function validateCustomHeaders(headers: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> | string {
  if (headers.length > MAX_CUSTOM_HEADERS) return `At most ${MAX_CUSTOM_HEADERS} custom headers.`;
  const cleaned = headers.map((header) => ({ name: header.name.trim(), value: header.value.trim() })).filter((header) => header.name || header.value);
  const names = new Set<string>();
  for (const header of cleaned) {
    if (!HEADER_NAME.test(header.name)) return `"${header.name}" isn't a valid header name (letters, digits and dashes).`;
    if (RESERVED_HEADERS.test(header.name)) return `${header.name} is set by Sentinel and can't be overridden.`;
    if (!header.value || header.value.length > 500 || /[\r\n]/.test(header.value)) return `The value for ${header.name} must be 1–500 characters on one line.`;
    if (names.has(header.name.toLowerCase())) return `${header.name} is listed twice.`;
    names.add(header.name.toLowerCase());
  }
  return cleaned;
}

export function verdictToWebhookStatus(
  verdict: "pass" | "review" | "reject",
): WebhookPayload["status"] {
  switch (verdict) {
    case "pass":
      return "PASS";
    case "review":
      return "REVIEW";
    case "reject":
      return "REJECT";
  }
}

// Provider step results can carry raw upstream error text (`{ error: "…" }`),
// which may include internal hostnames or response bodies. Replace every
// string `error` value with a generic code before it leaves Sentinel.
export function sanitizeWebhookResult(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeWebhookResult(item, depth + 1));
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "error" && typeof child === "string") {
      output[key] = "provider_error";
    } else {
      output[key] = sanitizeWebhookResult(child, depth + 1);
    }
  }
  return output;
}

export function buildWebhookPayload(params: {
  reference: string;
  verdict: "pass" | "review" | "reject";
  result: unknown;
  product?: string | null;
}): WebhookPayload {
  const monitoring = (params.result as { monitoring?: unknown } | null)?.monitoring;
  return {
    event: monitoring ? "sentinel.monitoring.alert" : "sentinel.scan.complete",
    scan_id: params.reference,
    status: verdictToWebhookStatus(params.verdict),
    timestamp: new Date().toISOString(),
    result: sanitizeWebhookResult(params.result ?? null),
    ...(params.product !== undefined ? { product: params.product } : {}),
  };
}

export async function signWebhookPayload(
  rawBody: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type WebhookDeliveryResult = {
  success: boolean;
  statusCode?: number;
  error?: string;
  // True when retrying can't help (blocked URL) — skip the retry schedule.
  permanent?: boolean;
  latencyMs?: number;
};

// Signature headers:
// - X-Sentinel-Signature: hex HMAC-SHA256(secret, body). Unchanged legacy
//   header, kept so existing integrations keep verifying.
// - X-Sentinel-Timestamp: unix seconds at send time.
// - X-Sentinel-Signature-V2: hex HMAC-SHA256(secret, `${timestamp}.${body}`).
//   Receivers should verify this one and reject stale timestamps (e.g. older
//   than 5 minutes) to get replay protection.
// - X-Sentinel-Signature-V2-Next: the same, signed with a rotated secret that
//   isn't active yet, so receivers can switch secrets without a gap.
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
  options: { nextSecret?: string; headers?: Array<{ name: string; value: string }> } = {},
): Promise<WebhookDeliveryResult> {
  // Re-validate at send time: the stored URL may predate validation.
  const urlCheck = checkOutboundUrl(url);
  if (!urlCheck.ok) {
    return { success: false, error: "blocked_url", permanent: true };
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const [signature, signatureV2, signatureNext] = await Promise.all([
    signWebhookPayload(rawBody, secret),
    signWebhookPayload(`${timestamp}.${rawBody}`, secret),
    options.nextSecret ? signWebhookPayload(`${timestamp}.${rawBody}`, options.nextSecret) : Promise.resolve(null),
  ]);

  const headers: Record<string, string> = {};
  // Custom headers first, so Sentinel's own always win.
  for (const header of options.headers ?? []) headers[header.name] = header.value;
  Object.assign(headers, {
    "Content-Type": "application/json",
    "X-Sentinel-Signature": signature,
    "X-Sentinel-Timestamp": timestamp,
    "X-Sentinel-Signature-V2": signatureV2,
    ...(signatureNext ? { "X-Sentinel-Signature-V2-Next": signatureNext } : {}),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(urlCheck.url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
      // Never follow redirects: a 3xx could bounce the request to an
      // internal address that passed none of the checks above.
      redirect: "manual",
    });
    const latencyMs = Date.now() - started;
    // The response body is never read, so nothing from the receiver flows back.
    const isRedirect = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    if (isRedirect) {
      return { success: false, statusCode: res.status || undefined, error: "redirect_not_followed", latencyMs };
    }
    return { success: res.ok, statusCode: res.status, latencyMs, ...(res.ok ? {} : { error: `http_${res.status}` }) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { success: false, error: aborted ? "timeout" : "network_error", latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

// What a delivery error code means, for the delivery log.
export const DELIVERY_ERROR_LABELS: Record<string, string> = {
  timeout: "No response within 10 seconds",
  network_error: "Couldn't connect (DNS, TLS or connection refused)",
  blocked_url: "The URL isn't a public HTTPS address",
  redirect_not_followed: "The endpoint redirected; Sentinel doesn't follow redirects",
  endpoint_paused: "Held while the endpoint is paused",
  endpoint_removed: "The endpoint was removed",
};

export function buildFailureWebhookPayload(params: {
  reference: string;
  failureReason?: string;
}): WebhookPayload {
  return {
    event: "sentinel.scan.complete",
    scan_id: params.reference,
    status: "FAILED",
    timestamp: new Date().toISOString(),
    result: { failureReason: params.failureReason ?? null },
  };
}
