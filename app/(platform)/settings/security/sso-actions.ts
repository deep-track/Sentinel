"use server";

import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import {
  Auth0ManagementError,
  createEnterpriseConnection,
  deleteEnterpriseConnection,
  isConnectionManagementConfigured,
  ssoCallbackDetails,
} from "@/backend/lib/auth0-management";
import { getErrorMessage } from "@/modules/shared/errors";

// Single sign-on setup (Settings → Security). Convex decides whether the
// caller may (sso.authorizeConnect / authorizeRemove: the client's Admin);
// only then is Auth0 changed. The identity provider's client secret or
// certificate goes straight to Auth0 and is never stored by Sentinel.

type Provider = "entra_id" | "google_workspace" | "saml" | "oidc";
type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export type SsoDetails = {
  clientIdValue?: string; // the IdP app's client id (Entra ID, Google, OIDC)
  clientSecret?: string;
  tenantDomain?: string; // Entra ID: e.g. yourbank.onmicrosoft.com
  discoveryUrl?: string; // OIDC: https://idp/.well-known/openid-configuration
  signInUrl?: string; // SAML
  signOutUrl?: string; // SAML
  certificate?: string; // SAML: PEM
};

const PROVIDER_LABELS: Record<Provider, string> = {
  entra_id: "Microsoft Entra ID",
  google_workspace: "Google Workspace",
  saml: "SAML",
  oidc: "OpenID Connect",
};

function auth0Error(error: unknown, fallback: string) {
  if (error instanceof Auth0ManagementError) {
    if (error.status === 403) return "Auth0 refused: the Management API app needs the create:connections, delete:connections and create:organization_connections scopes (or your Auth0 plan doesn't include enterprise connections).";
    return `Auth0 refused the connection (${error.status})${error.auth0Message ? `: ${error.auth0Message}` : "."}`;
  }
  return getErrorMessage(error, fallback);
}

function httpsUrl(value: string | undefined, label: string): string {
  try {
    const url = new URL((value ?? "").trim());
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${label} must be an https:// URL.`);
  }
}

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > 4000) throw new Error(`${label} is too long.`);
  return trimmed;
}

// Auth0 connection options for each provider.
function connectionOptions(provider: Provider, details: SsoDetails, domains: string[]) {
  const [primary] = domains;
  switch (provider) {
    case "entra_id":
      return {
        strategy: "waad" as const,
        options: {
          client_id: required(details.clientIdValue, "The application (client) ID"),
          client_secret: required(details.clientSecret, "The client secret"),
          tenant_domain: required(details.tenantDomain, "The tenant domain"),
          domain: primary,
          domain_aliases: domains,
          waad_protocol: "openid-connect",
          identity_api: "microsoft-identity-platform-v2.0",
          useCommonEndpoint: false,
        },
      };
    case "google_workspace":
      return {
        strategy: "google-apps" as const,
        options: {
          client_id: required(details.clientIdValue, "The OAuth client ID"),
          client_secret: required(details.clientSecret, "The client secret"),
          domain: primary,
          tenant_domain: primary,
          domain_aliases: domains,
        },
      };
    case "saml": {
      const pem = required(details.certificate, "The signing certificate");
      if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem)) throw new Error("Paste the signing certificate in PEM format (-----BEGIN CERTIFICATE----- …).");
      return {
        strategy: "samlp" as const,
        options: {
          signInEndpoint: httpsUrl(details.signInUrl, "The sign-in URL"),
          ...(details.signOutUrl?.trim() ? { signOutEndpoint: httpsUrl(details.signOutUrl, "The sign-out URL") } : {}),
          signingCert: Buffer.from(pem, "utf8").toString("base64"),
          signatureAlgorithm: "rsa-sha256",
          digestAlgorithm: "sha256",
          domain_aliases: domains,
        },
      };
    }
    case "oidc":
      return {
        strategy: "oidc" as const,
        options: {
          type: "back_channel",
          discovery_url: httpsUrl(details.discoveryUrl, "The discovery URL"),
          client_id: required(details.clientIdValue, "The client ID"),
          client_secret: required(details.clientSecret, "The client secret"),
          scope: "openid profile email",
          domain_aliases: domains,
        },
      };
  }
}

// Step 1: choose the provider and domains. Returns what to enter in the
// identity provider (callback URL; for SAML the ACS URL and entity ID).
export async function startSso(clientId: string, provider: Provider, domains: string[]): Promise<Result<{ connectionName: string; callback: ReturnType<typeof ssoCallbackDetails> }>> {
  const convex = await getAuthenticatedConvexClient();
  if (!convex) return { ok: false, error: "Your session has expired. Sign in again." };
  if (!isConnectionManagementConfigured()) return { ok: false, error: "Single sign-on can't be set up on this deployment yet (Auth0 Management access isn't configured). Contact DeepTrack." };
  try {
    const { connectionName } = (await convex.mutation(anyApi.sso.authorizeConnect, { clientId, provider, domains })) as { connectionName: string };
    return { ok: true, connectionName, callback: ssoCallbackDetails(connectionName) };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "Single sign-on couldn't be started.") };
  }
}

// Step 2: the identity provider's details. Creates the Auth0 connection.
export async function finishSso(clientId: string, details: SsoDetails): Promise<Result> {
  const convex = await getAuthenticatedConvexClient();
  if (!convex) return { ok: false, error: "Your session has expired. Sign in again." };
  let sso: { status: string; provider: Provider; connectionName: string; domains: string[] } | null;
  try {
    sso = await convex.query(anyApi.sso.get, { clientId });
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "Only your organization's Admin can set up single sign-on.") };
  }
  if (!sso || sso.status !== "pending") return { ok: false, error: "Start setting up single sign-on first." };
  let built: ReturnType<typeof connectionOptions>;
  try {
    built = connectionOptions(sso.provider, details, sso.domains);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Check the details and try again." };
  }
  try {
    const { id } = await createEnterpriseConnection({
      name: sso.connectionName,
      displayName: `${PROVIDER_LABELS[sso.provider]} (${sso.domains[0]})`,
      strategy: built.strategy,
      options: built.options,
    });
    await convex.mutation(anyApi.sso.recordConnected, { clientId, connectionId: id });
    return { ok: true };
  } catch (error) {
    console.error("[sso] connection failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return { ok: false, error: auth0Error(error, "The connection couldn't be created.") };
  }
}

export async function removeSso(clientId: string): Promise<Result> {
  const convex = await getAuthenticatedConvexClient();
  if (!convex) return { ok: false, error: "Your session has expired. Sign in again." };
  try {
    const { connectionId } = (await convex.mutation(anyApi.sso.authorizeRemove, { clientId })) as { connectionId: string | null };
    if (connectionId) await deleteEnterpriseConnection(connectionId);
    await convex.mutation(anyApi.sso.recordRemoved, { clientId });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: auth0Error(error, "Single sign-on couldn't be removed.") };
  }
}
