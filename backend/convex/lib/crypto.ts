export function randomKeySegment(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Bearer: gt_{live|test}
export function buildRawApiKey(environment: "live" | "test") {
  const secret = randomKeySegment(24); // 48 hex chars
  const prefix = `gt_${environment}_${secret.slice(0, 8)}`;
  const rawKey = `${prefix}_${secret.slice(8)}`;
  return { rawKey, prefix };
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