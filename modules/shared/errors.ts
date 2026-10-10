import { ConvexError } from "convex/values";

const FRIENDLY_MESSAGES: Record<string, string> = {
  insufficient_credits:
    "Your organization doesn't have enough verification credits for this check. Top up on the Billing & Credits page or contact your account manager.",
  unauthenticated: "Your session has expired. Sign in again and retry.",
  forbidden: "You don't have permission to do this for the selected organization.",
  rate_limited: "Too many requests. Please wait a moment and try again.",
  invalid_argument: "Some of the submitted information is invalid. Check the form and try again.",
  unsupported: "This option isn't supported.",
  payload_too_large: "One of the images is too large. Use a smaller or cropped photo and try again.",
};

function formatRetryAfter(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function getConvexErrorData(error: unknown): unknown {
  if (error instanceof ConvexError) return error.data;
  // ConvexHttpClient / separately bundled copies of convex may not share the
  // class identity, so fall back to duck typing.
  if (error && typeof error === "object" && "data" in error) {
    return (error as { data?: unknown }).data;
  }
  return undefined;
}

/** Returns the `code` carried by a ConvexError (`{ code, message }` payloads), if any. */
export function getConvexErrorCode(error: unknown): string | null {
  const data = getConvexErrorData(error);
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** The user-facing `message` of a ConvexError payload, or null for any other error. */
export function getConvexErrorMessage(error: unknown): string | null {
  const data = getConvexErrorData(error);
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

/**
 * Turns a thrown Convex/JS error into a message that's safe to show users.
 * ConvexError payloads carry a clean `message`; uncaught server errors carry
 * request ids and stack noise, so those fall back to `fallback`.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const code = getConvexErrorCode(error);
  // Credits errors always get the actionable copy, whatever the backend says.
  if (code === "insufficient_credits") return FRIENDLY_MESSAGES.insufficient_credits;
  if (code === "rate_limited") {
    const data = getConvexErrorData(error) as { retryAfterMs?: unknown } | undefined;
    const retryAfterMs = typeof data?.retryAfterMs === "number" ? data.retryAfterMs : 0;
    return retryAfterMs > 0
      ? `Too many requests. Try again in ${formatRetryAfter(retryAfterMs)}.`
      : FRIENDLY_MESSAGES.rate_limited;
  }

  const convexMessage = getConvexErrorMessage(error);
  if (convexMessage) return convexMessage;
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code];
  if (getConvexErrorData(error) !== undefined) return fallback;

  if (error instanceof Error && error.message && !error.message.includes("[CONVEX") && !error.message.includes("[Request ID")) {
    return error.message;
  }
  return fallback;
}
