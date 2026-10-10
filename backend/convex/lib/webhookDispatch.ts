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

// payload
export type WebhookPayload = {
  event: "sentinel.scan.complete";
  scan_id: string;
  status: "PASS" | "REVIEW" | "REJECT" | "FAILED";
  timestamp: string; // ISO 8601
  result: unknown;
};

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
}): WebhookPayload {
  return {
    event: "sentinel.scan.complete",
    scan_id: params.reference,
    status: verdictToWebhookStatus(params.verdict),
    timestamp: new Date().toISOString(),
    result: sanitizeWebhookResult(params.result ?? null),
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
};

// Signature headers:
// - X-Sentinel-Signature: hex HMAC-SHA256(secret, body). Unchanged legacy
//   header, kept so existing integrations keep verifying.
// - X-Sentinel-Timestamp: unix seconds at send time.
// - X-Sentinel-Signature-V2: hex HMAC-SHA256(secret, `${timestamp}.${body}`).
//   Receivers should verify this one and reject stale timestamps (e.g. older
//   than 5 minutes) to get replay protection.
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
): Promise<WebhookDeliveryResult> {
  // Re-validate at send time: the stored URL may predate validation.
  const urlCheck = checkOutboundUrl(url);
  if (!urlCheck.ok) {
    return { success: false, error: "blocked_url", permanent: true };
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const [signature, signatureV2] = await Promise.all([
    signWebhookPayload(rawBody, secret),
    signWebhookPayload(`${timestamp}.${rawBody}`, secret),
  ]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(urlCheck.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentinel-Signature": signature,
        "X-Sentinel-Timestamp": timestamp,
        "X-Sentinel-Signature-V2": signatureV2,
      },
      body: rawBody,
      signal: controller.signal,
      // Never follow redirects: a 3xx could bounce the request to an
      // internal address that passed none of the checks above.
      redirect: "manual",
    });
    // The response body is never read, so nothing from the receiver flows back.
    const isRedirect = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    if (isRedirect) {
      return { success: false, statusCode: res.status || undefined, error: "redirect_not_followed" };
    }
    return { success: res.ok, statusCode: res.status };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { success: false, error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

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
