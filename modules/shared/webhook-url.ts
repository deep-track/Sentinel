// Client-side pre-check for webhook endpoints. The backend
// (clients.registerWebhook) is the real enforcement point; this only gives
// users an immediate, specific error.

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

function isPrivateIPv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.startsWith("::ffff:")
  );
}

/** Returns an error message, or null when the URL is acceptable. */
export function validateWebhookUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter an endpoint URL.";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, for example https://your-app.com/webhooks/sentinel.";
  }

  if (url.protocol !== "https:") return "Webhook endpoints must use https://.";
  if (url.username || url.password) return "Remove the username/password from the URL.";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    (!host.includes(".") && !host.includes(":")) ||
    isPrivateIPv4(host) ||
    isPrivateIPv6(host)
  ) {
    return "Webhook endpoints must be reachable on the public internet (no localhost or private network addresses).";
  }

  return null;
}
