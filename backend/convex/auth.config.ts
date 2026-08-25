import { AuthConfig } from "convex/server";

function normalizeAuth0Domain(value: string) {
  const withoutScheme = value.trim().replace(/^https?:\/\//, "");
  return withoutScheme.replace(/\/+$/, "");
}

const rawDomain = process.env.AUTH0_DOMAIN?.trim();
const applicationID = process.env.AUTH0_CLIENT_ID?.trim();

if (!rawDomain || !applicationID) {
  throw new Error("AUTH0_DOMAIN and AUTH0_CLIENT_ID must be configured");
}

export default {
  providers: [
    {
      // Convex expects the Auth0 issuer hostname, not a URL with scheme.
      domain: normalizeAuth0Domain(rawDomain),
      applicationID,
    },
  ],
} satisfies AuthConfig;
