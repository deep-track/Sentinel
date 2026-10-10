import { ConvexError } from "convex/values";

// Outbound URL policy for client-supplied webhook endpoints (SSRF guard).
//
// Checked when the URL is registered AND again right before every delivery.
// Limitation: Convex's runtime has no DNS API, so a public hostname that
// resolves to a private address (DNS rebinding) cannot be detected here;
// redirects are never followed (see lib/webhookDispatch.ts), which closes the
// redirect-based variant.

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".lan",
  ".intranet",
  ".corp",
];

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isBlockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF / TEST-NET-1
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

// Only global unicast (2000::/3) is allowed for IPv6 literals; everything
// else (loopback, unspecified, ULA fc00::/7, link-local fe80::/10, multicast,
// IPv4-mapped ::ffff:0:0/96, NAT64) is rejected. Documentation 2001:db8::/32
// is rejected too.
function isBlockedIpv6(host: string): boolean {
  const address = host.toLowerCase();
  if (address.startsWith("2001:db8:") || address.startsWith("2001:0db8:")) return true;
  const firstGroup = address.split(":")[0];
  if (!firstGroup) return true; // "::", "::1", "::ffff:…"
  const value = Number.parseInt(firstGroup, 16);
  if (!Number.isFinite(value)) return true;
  return (value & 0xe000) !== 0x2000;
}

export function checkOutboundUrl(raw: string): UrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "URL is required." };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "URL is too long." };

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "URL is not valid." };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "Webhook URLs must use https." };
  if (url.username || url.password) {
    return { ok: false, reason: "Webhook URLs must not contain credentials." };
  }

  // WHATWG URL parsing already normalises numeric IPv4 forms (e.g.
  // 2130706433, 0x7f.1) to dotted decimal, so the checks below see them.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, reason: "URL has no host." };

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return isBlockedIpv6(hostname.slice(1, -1))
      ? { ok: false, reason: "Webhook URLs must not target private or reserved addresses." }
      : { ok: true, url: url.toString() };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    return isBlockedIpv4(ipv4)
      ? { ok: false, reason: "Webhook URLs must not target private or reserved addresses." }
      : { ok: true, url: url.toString() };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !hostname.includes(".") // single-label names only resolve on private networks
  ) {
    return { ok: false, reason: "Webhook URLs must use a public hostname." };
  }

  return { ok: true, url: url.toString() };
}

export function assertSafeWebhookUrl(raw: string): string {
  const result = checkOutboundUrl(raw);
  if (!result.ok) {
    throw new ConvexError({ code: "invalid_argument", message: result.reason });
  }
  return result.url;
}
