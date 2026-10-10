import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function originOf(value: string | undefined, protocol?: "https:" | "wss:") {
  if (!value?.trim()) return null;
  try {
    const raw = value.trim();
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (protocol) url.protocol = protocol;
    return url.origin;
  } catch {
    return null;
  }
}

// Headers are computed when the config is loaded (build / server start), so
// the env-specific origins below are picked up from the deployment env.
const convexHttp = originOf(process.env.NEXT_PUBLIC_CONVEX_URL);
const convexWs = originOf(process.env.NEXT_PUBLIC_CONVEX_URL, "wss:");
const auth0Origin = originOf(process.env.AUTH0_DOMAIN);

const sources = (...values: Array<string | null | false | undefined>) =>
  values.filter(Boolean).join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js App Router injects inline bootstrap scripts; dev needs eval for
  // React Refresh.
  `script-src ${sources("'self'", "'unsafe-inline'", isDev && "'unsafe-eval'")}`,
  "style-src 'self' 'unsafe-inline'",
  // Uploaded documents (UploadThing CDN), Auth0/Gravatar avatars, previews.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src ${sources(
    "'self'",
    "data:",
    "blob:",
    // Convex client (HTTP + WebSocket sync)
    "https://*.convex.cloud",
    "wss://*.convex.cloud",
    "https://*.convex.site",
    convexHttp,
    convexWs,
    // UploadThing: presigned PUTs go to <region>.ingest.uploadthing.com
    "https://*.uploadthing.com",
    "https://*.ingest.uploadthing.com",
    "https://uploadthing.com",
    "https://*.ufs.sh",
    "https://utfs.io",
    isDev && "ws:",
  )}`,
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // /sign-in submits a GET form to /auth/login, which redirects to Auth0;
  // Chromium applies form-action to that redirect target.
  `form-action ${sources("'self'", "https://*.auth0.com", auth0Origin)}`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.ufs.sh",
      },
      {
        protocol: "https",
        hostname: "uploadthing.com",
      },
      {
        protocol: "https",
        hostname: "utfs.io",
      },
    ],
  },
  eslint: {
    // Lint must pass for a production build.
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
