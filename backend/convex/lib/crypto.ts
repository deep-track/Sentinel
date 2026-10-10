export function randomKeySegment(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Length (hex chars) of the public lookup segment. 16 hex = 64 bits, so
// prefix collisions are negligible; callers still retry on collision.
export const API_KEY_PREFIX_HEX_LENGTH = 16;
// Keys issued before the prefix was widened used 8 hex chars (32 bits).
export const LEGACY_API_KEY_PREFIX_HEX_LENGTH = 8;

// Bearer: gt_{live|test}_{16 hex prefix}_{48 hex secret}
export function buildRawApiKey(environment: "live" | "test") {
  const secret = randomKeySegment(32); // 64 hex chars
  const prefix = `gt_${environment}_${secret.slice(0, API_KEY_PREFIX_HEX_LENGTH)}`;
  const rawKey = `${prefix}_${secret.slice(API_KEY_PREFIX_HEX_LENGTH)}`;
  return { rawKey, prefix };
}

// Extracts the lookup prefix from a presented key, accepting both the
// current (16 hex) and legacy (8 hex) formats. Returns null when malformed.
export function parseApiKeyPrefix(rawKey: string): string | null {
  const parts = rawKey.split("_");
  if (parts.length !== 4 || parts[0] !== "gt") return null;
  if (parts[1] !== "live" && parts[1] !== "test") return null;
  const lookup = parts[2];
  if (
    !/^[0-9a-f]+$/.test(lookup) ||
    (lookup.length !== API_KEY_PREFIX_HEX_LENGTH &&
      lookup.length !== LEGACY_API_KEY_PREFIX_HEX_LENGTH)
  ) {
    return null;
  }
  if (!/^[0-9a-f]+$/.test(parts[3])) return null;
  return `${parts[0]}_${parts[1]}_${lookup}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function buildVerificationReference(): string {
  return `ver_${randomKeySegment(16)}`;
}
