// Ordinal (code-point) comparison. Twilio canonicalises parameters with a
// byte-wise, case-sensitive sort, so locale-aware comparison (localeCompare)
// can order keys differently and reject valid callbacks.
export function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index].codePointAt(0) ?? 0) - (b[index].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

export function twilioSignaturePayload(url: string, params: URLSearchParams): string {
  const values = Array.from(params.entries()).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      compareCodePoints(leftKey, rightKey) || compareCodePoints(leftValue, rightValue),
  );
  return url + values.map(([key, value]) => key + value).join("");
}

export async function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string | null, authToken: string): Promise<boolean> {
  if (!signature || !authToken) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["verify"]);
  let provided: Uint8Array;
  try { provided = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0)); } catch { return false; }
  if (provided.length !== 20) return false;
  return crypto.subtle.verify("HMAC", key, provided as unknown as BufferSource, new TextEncoder().encode(twilioSignaturePayload(url, params)));
}

export type TwilioDeliveryStatus = "sent" | "delivered" | "failed" | "undelivered";

// Maps Twilio's MessageStatus onto our delivery states. In-progress and
// unrecognised statuses map to "sent", which never fails a verification and
// is ignored once a later state has been recorded.
export function mapTwilioDeliveryStatus(status: string | null): TwilioDeliveryStatus {
  switch ((status ?? "").trim().toLowerCase()) {
    case "delivered":
    case "read":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "sent";
  }
}
