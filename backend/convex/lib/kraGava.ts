import { nameMatchScore, normalizeKraPin, KRA_PIN_PATTERN } from "./documentChecks";

// KRA PIN checks through GavaConnect, the Kenya Revenue Authority's
// official API gateway (developer.go.ke). Env:
//   KRA_GAVA_CONSUMER_KEY, KRA_GAVA_CONSUMER_SECRET  the app's keys from
//     developer.go.ke, subscribed to the PIN Checker API
//   KRA_GAVA_ENVIRONMENT  "production" (default) or "sandbox"
// Without the keys the check is skipped.

export const KRA_BASE_URLS = { production: "https://api.kra.go.ke", sandbox: "https://sbx.kra.go.ke" } as const;

export type KraConfig = { consumerKey: string; consumerSecret: string; baseUrl: string };

export function kraConfigFromEnv(env: Record<string, string | undefined>): KraConfig | null {
  const consumerKey = env.KRA_GAVA_CONSUMER_KEY?.trim();
  const consumerSecret = env.KRA_GAVA_CONSUMER_SECRET?.trim();
  if (!consumerKey || !consumerSecret) return null;
  const environment = env.KRA_GAVA_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
  return { consumerKey, consumerSecret, baseUrl: KRA_BASE_URLS[environment] };
}

export type KraLookup =
  | { status: "found"; pin: string; name: string | null; taxpayerType: string | null; pinStatus: string | null }
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// The PIN checker's answer: PINDATA with the taxpayer, or an error message.
export function parseKraPinResponse(raw: unknown): KraLookup {
  if (!raw || typeof raw !== "object") return { status: "error", message: "KRA returned an unreadable response." };
  const body = raw as Record<string, unknown>;
  const data = (body.PINDATA ?? body.PinData ?? body.pinData) as Record<string, unknown> | undefined;
  const pin = data ? normalizeKraPin(text(data.KRAPIN) ?? text(data.KraPin) ?? "") : "";
  if (data && pin) {
    return {
      status: "found",
      pin,
      name: text(data.Name) ?? text(data.TaxpayerName),
      taxpayerType: text(data.TypeOfTaxpayer),
      pinStatus: text(data.StatusOfPIN) ?? text(data.PINStatus),
    };
  }
  const message = text(body.ErrorMessage) ?? text(body.Message) ?? text(body.errorMessage) ?? "KRA has no record of this PIN.";
  // KRA answers an unknown PIN with an error message, not an HTTP error.
  if (/not\s*(found|exist|registered|valid)|invalid|no record/i.test(message)) return { status: "not_found", message: message.slice(0, 300) };
  return { status: "error", message: message.slice(0, 300) };
}

export type KraPinLookup = (pin: string) => Promise<KraLookup>;

const TIMEOUT_MS = 15_000;

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// A PIN lookup with a token per lookup batch. Errors become
// { status: "error" }, never exceptions, so a KRA outage never fails a check.
export function kraPinLookup(config: KraConfig): KraPinLookup {
  let token: string | null = null;
  return async (pin: string) => {
    try {
      if (!token) {
        const basic = btoa(`${config.consumerKey}:${config.consumerSecret}`);
        const auth = await fetchJson(`${config.baseUrl}/v1/token/generate?grant_type=client_credentials`, { method: "GET", headers: { Authorization: `Basic ${basic}` } });
        const accessToken = text((auth.body as Record<string, unknown> | null)?.access_token);
        if (auth.status !== 200 || !accessToken) return { status: "error", message: `KRA sign-in failed (HTTP ${auth.status}).` };
        token = accessToken;
      }
      const response = await fetchJson(`${config.baseUrl}/checker/v1/pinbypin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ KRAPIN: pin }),
      });
      if (response.status === 401) token = null;
      if (response.status >= 500 || response.status === 401 || response.status === 429) return { status: "error", message: `KRA is unavailable (HTTP ${response.status}).` };
      return parseKraPinResponse(response.body);
    } catch (error) {
      return { status: "error", message: error instanceof Error && error.name === "AbortError" ? "KRA didn't answer in time." : "KRA couldn't be reached." };
    }
  };
}

export type KraComparison = {
  outcome: "verified" | "not_registered" | "name_mismatch" | "inactive" | "unavailable" | "skipped";
  message: string;
  nameMatch: number | null;
};

// A PIN's KRA record against the name it should belong to.
export function compareKraRecord(lookup: KraLookup, expectedName: string | null, normalize: (name: string) => string = (name) => name): KraComparison {
  if (lookup.status === "error") return { outcome: "unavailable", message: `The PIN couldn't be checked with KRA: ${lookup.message}`, nameMatch: null };
  if (lookup.status === "not_found") return { outcome: "not_registered", message: "KRA has no record of this PIN.", nameMatch: null };
  const nameMatch = expectedName && lookup.name ? nameMatchScore(normalize(expectedName), normalize(lookup.name)) : null;
  if (nameMatch !== null && nameMatch < 0.67) {
    return { outcome: "name_mismatch", message: `KRA registers this PIN to "${lookup.name}", not "${expectedName}".`, nameMatch };
  }
  if (lookup.pinStatus && !/^active$/i.test(lookup.pinStatus)) {
    return { outcome: "inactive", message: `The PIN's status at KRA is ${lookup.pinStatus}.`, nameMatch };
  }
  return { outcome: "verified", message: `KRA confirms the PIN${lookup.name ? ` belongs to ${lookup.name}` : ""}${lookup.pinStatus ? ` (${lookup.pinStatus})` : ""}.`, nameMatch };
}

export function checkablePin(value: string | null | undefined): string | null {
  const pin = normalizeKraPin(value);
  return KRA_PIN_PATTERN.test(pin) ? pin : null;
}
