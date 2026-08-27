export function twilioSignaturePayload(url: string, params: URLSearchParams): string {
  const values = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right));
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

export function mapTwilioDeliveryStatus(status: string | null): "sent" | "failed" {
  return ["queued", "accepted", "sending", "sent", "delivered", "read"].includes((status ?? "").toLowerCase()) ? "sent" : "failed";
}
