import { getCurrentUser } from "@/lib/auth";

const REQUIRED_ENV = [
  "AUTH0_DOMAIN",
  "AUTH0_MANAGEMENT_CLIENT_ID",
  "AUTH0_MANAGEMENT_CLIENT_SECRET",
  "AUTH0_ORGANIZATION_ID",
  "AUTH0_INVITATION_CLIENT_ID",
  "AUTH0_INVITATION_CONNECTION_ID",
] as const;

type Auth0ManagementConfig = {
  domain: string;
  managementClientId: string;
  managementClientSecret: string;
  organizationId: string;
  invitationClientId: string;
  invitationConnectionId: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function getConfig(): Auth0ManagementConfig {
  const values = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, process.env[name]?.trim()]),
  ) as Partial<Record<(typeof REQUIRED_ENV)[number], string | undefined>>;

  const missing = REQUIRED_ENV.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new Error(`Auth0 Organizations is not configured: missing ${missing.join(", ")}`);
  }

  return {
    domain: values.AUTH0_DOMAIN as string,
    managementClientId: values.AUTH0_MANAGEMENT_CLIENT_ID as string,
    managementClientSecret: values.AUTH0_MANAGEMENT_CLIENT_SECRET as string,
    organizationId: values.AUTH0_ORGANIZATION_ID as string,
    invitationClientId: values.AUTH0_INVITATION_CLIENT_ID as string,
    invitationConnectionId: values.AUTH0_INVITATION_CONNECTION_ID as string,
  };
}

function getManagementOrigin(domain: string) {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

async function getManagementToken(config: Auth0ManagementConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const response = await fetch(`${getManagementOrigin(config.domain)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.managementClientId,
      client_secret: config.managementClientSecret,
      audience: `${getManagementOrigin(config.domain)}/api/v2/`,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Auth0 management token request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("Auth0 management token response did not include an access token");
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 86_400) * 1000,
  };
  return payload.access_token;
}

async function managementRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getConfig();
  const token = await getManagementToken(config);
  const response = await fetch(`${getManagementOrigin(config.domain)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Auth0 management request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function requireInvitationAdministrator() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "head")) {
    throw new Error("Invitation administration requires an administrator session");
  }
  return user;
}

export async function createOrganizationInvitation(email: string, redirectUrl: string) {
  const user = await requireInvitationAdministrator();
  const config = getConfig();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("A valid invitee email is required");
  }

  return managementRequest<{ id: string; invitation_url?: string }>(
    `/api/v2/organizations/${encodeURIComponent(config.organizationId)}/invitations`,
    {
      method: "POST",
      body: JSON.stringify({
        inviter: { name: user.fullName, email: user.email },
        invitee: { email: normalizedEmail },
        client_id: config.invitationClientId,
        connection_id: config.invitationConnectionId,
        ttl_sec: 7 * 24 * 60 * 60,
        send_invitation_email: true,
        app_metadata: { redirectUrl },
      }),
    },
  );
}

export async function revokeOrganizationInvitation(invitationId: string) {
  await requireInvitationAdministrator();
  const config = getConfig();
  if (!invitationId.trim()) throw new Error("Invitation ID is required");
  await managementRequest<void>(
    `/api/v2/organizations/${encodeURIComponent(config.organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );
}
