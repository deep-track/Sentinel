export const WEBHOOK_RETRY_SCHEDULE_MS = [
  60 * 1000,         
  5 * 60 * 1000,      
  30 * 60 * 1000,       
  2 * 60 * 60 * 1000,  
  6 * 60 * 60 * 1000,  
  24 * 60 * 60 * 1000,    
];

export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1; 

// payload
export type WebhookPayload = {
  event: "sentinel.scan.complete";
  scan_id: string;
  status: "PASS" | "REVIEW" | "REJECT";
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
    result: params.result,
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

export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const rawBody = JSON.stringify(payload);
  const signature = await signWebhookPayload(rawBody, secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentinel-Signature": signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // retry schedule
    return { success: res.ok, statusCode: res.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}