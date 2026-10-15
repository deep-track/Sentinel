// Paystack (https://paystack.com/docs/api): card and mobile-money payments
// for invoices, and charging a saved card for automatic top-ups. The secret
// key (PAYSTACK_SECRET_KEY) authenticates API calls and signs webhooks.

export const PAYSTACK_API = "https://api.paystack.co";
// Paystack's webhook senders (test and live).
export const PAYSTACK_WEBHOOK_IPS = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];

export type PaystackTransaction = {
  status: string; // success | failed | abandoned | ongoing | pending | ...
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  gateway_response?: string;
  customer?: { email?: string };
  authorization?: {
    authorization_code?: string;
    reusable?: boolean;
    last4?: string;
    brand?: string;
    exp_month?: string;
    exp_year?: string;
    channel?: string;
  };
};

export function paystackSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.PAYSTACK_SECRET_KEY?.trim() || null;
}

async function call<T>(secret: string, path: string, init: { method: "GET" | "POST"; body?: unknown }, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(`${PAYSTACK_API}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${secret}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: { status?: boolean; message?: string; data?: T } | null = null;
  try {
    body = (await response.json()) as { status?: boolean; message?: string; data?: T };
  } catch {
    body = null;
  }
  if (!response.ok || !body?.status || body.data === undefined) {
    throw new Error(`Paystack ${path.split("/")[2] ?? "request"} failed: ${(body?.message ?? `HTTP ${response.status}`).slice(0, 200)}`);
  }
  return body.data;
}

export async function initializeTransaction(
  secret: string,
  params: { email: string; amount: number; currency: string; reference: string; callbackUrl: string; metadata: Record<string, unknown> },
  fetchImpl: typeof fetch = fetch,
): Promise<{ authorization_url: string; access_code: string; reference: string }> {
  return await call(secret, "/transaction/initialize", {
    method: "POST",
    body: {
      email: params.email,
      amount: String(params.amount),
      currency: params.currency,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: JSON.stringify(params.metadata),
    },
  }, fetchImpl);
}

export async function verifyTransaction(secret: string, reference: string, fetchImpl: typeof fetch = fetch): Promise<PaystackTransaction> {
  return await call(secret, `/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }, fetchImpl);
}

export async function chargeAuthorization(
  secret: string,
  params: { email: string; amount: number; currency: string; reference: string; authorizationCode: string; metadata: Record<string, unknown> },
  fetchImpl: typeof fetch = fetch,
): Promise<PaystackTransaction> {
  return await call(secret, "/transaction/charge_authorization", {
    method: "POST",
    body: {
      email: params.email,
      amount: String(params.amount),
      currency: params.currency,
      reference: params.reference,
      authorization_code: params.authorizationCode,
      metadata: JSON.stringify(params.metadata),
    },
  }, fetchImpl);
}

// x-paystack-signature: HMAC-SHA512 of the raw body with the secret key.
export async function validPaystackSignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const given = signature.toLowerCase();
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Whether a verified transaction pays exactly what was asked.
export function paymentMatches(transaction: PaystackTransaction, expected: { reference: string; amount: number; currency: string }): boolean {
  return (
    transaction.status === "success" &&
    transaction.reference === expected.reference &&
    transaction.amount === expected.amount &&
    transaction.currency?.toUpperCase() === expected.currency
  );
}

export function paymentReference(random: string): string {
  return `snt-${random}`.replace(/[^A-Za-z0-9.=-]/g, "").slice(0, 60);
}
