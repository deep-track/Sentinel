// Africa's Talking SMS (https://developers.africastalking.com/docs/sms).
// No imports, so tests can transpile and evaluate this file directly.

export type AfricasTalkingDeliveryStatus = "sent" | "delivered" | "failed" | "undelivered";

export type AfricasTalkingSendOutcome = { ok: true; sid: string } | { ok: false; reason: string };

// The "sandbox" app username routes to the sandbox API host.
export function africasTalkingSmsUrl(username: string): string {
  const host = username.trim() === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  return `https://${host}/version1/messaging`;
}

export function africasTalkingSmsBody(params: { username: string; to: string; message: string; senderId?: string }): URLSearchParams {
  const body = new URLSearchParams({ username: params.username, to: params.to, message: params.message });
  if (params.senderId?.trim()) body.set("from", params.senderId.trim());
  return body;
}

// Recipient status codes that mean the message was accepted:
// 100 Processed, 101 Sent, 102 Queued. Everything else (401 RiskHold,
// 402 InvalidSenderId, 403 InvalidPhoneNumber, 405 InsufficientBalance,
// 406 UserInBlacklist, 407 CouldNotRoute, 5xx gateway errors, ...) is a failure.
const ACCEPTED_STATUS_CODES = new Set([100, 101, 102]);

export function parseAfricasTalkingSendResponse(payload: unknown): AfricasTalkingSendOutcome {
  const data = (payload as { SMSMessageData?: { Recipients?: unknown } } | null)?.SMSMessageData;
  const recipients = Array.isArray(data?.Recipients) ? data.Recipients : [];
  const recipient = recipients[0] as { statusCode?: unknown; status?: unknown; messageId?: unknown } | undefined;
  if (!recipient) return { ok: false, reason: "Provider response did not include a recipient." };
  const statusCode = Number(recipient.statusCode);
  if (!ACCEPTED_STATUS_CODES.has(statusCode)) {
    const status = typeof recipient.status === "string" && recipient.status.trim() ? recipient.status.trim().slice(0, 60) : "rejected";
    return { ok: false, reason: `Provider rejected the message (${status}).` };
  }
  const messageId = typeof recipient.messageId === "string" ? recipient.messageId.trim() : "";
  // Never store a placeholder id: a message we can't correlate is a failure.
  if (!messageId || messageId.toLowerCase() === "none") {
    return { ok: false, reason: "Provider response did not include a message id." };
  }
  return { ok: true, sid: messageId };
}

// Maps an Africa's Talking delivery report status onto our delivery states.
// In-flight and unrecognised statuses map to "sent", which never fails a
// verification and is ignored once a later state has been recorded.
export function mapAfricasTalkingDeliveryStatus(status: string | null): AfricasTalkingDeliveryStatus {
  switch ((status ?? "").trim().toLowerCase()) {
    case "success":
      return "delivered";
    case "absentsubscriber":
    case "expired":
      return "undelivered";
    case "failed":
    case "rejected":
      return "failed";
    default:
      return "sent";
  }
}

// Delivery reports are not signed, so the callback URL carries a shared
// secret. Compared without an early exit on the first differing character.
export function callbackTokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}
