import { type AppUser, getCurrentUser, isInternalAdminRole } from "@/backend/lib/auth";

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

export class Auth0ManagementError extends Error {
  constructor(
    readonly status: number,
    // Auth0's own explanation (e.g. a missing scope or an invalid option).
    readonly auth0Message?: string,
  ) {
    super(`Auth0 management request failed with status ${status}`);
    this.name = "Auth0ManagementError";
  }
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
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Auth0ManagementError(response.status, typeof body?.message === "string" ? body.message.slice(0, 300) : undefined);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Invitation administrators are internal admins (internal_admin / head /
// admin, matching backend/convex/lib/rbac.ts) without the view_only role.
async function requireInvitationAdministrator(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user || !isInternalAdminRole(user.role) || user.viewOnly) {
    throw new Error("Invitation administration requires an administrator session");
  }
  return user;
}

// Only `internal_admin` (Auth0 internal_admin / administrator) may manage
// invitations for any company. `head` / `admin` sessions are limited to the
// company in their own companyId claim.
function canManageCompany(user: AppUser, companyId: string | undefined) {
  if (user.role === "internal_admin") return true;
  return Boolean(companyId) && Boolean(user.companyId) && user.companyId === companyId;
}

type OrganizationInvitation = {
  id: string;
  invitation_url?: string;
  app_metadata?: Record<string, unknown>;
};

function invitationsPath(config: Auth0ManagementConfig, invitationId?: string) {
  const base = `/api/v2/organizations/${encodeURIComponent(config.organizationId)}/invitations`;
  return invitationId ? `${base}/${encodeURIComponent(invitationId)}` : base;
}

export async function createOrganizationInvitation(params: {
  email: string;
  redirectUrl: string;
  companyId: string;
}) {
  const user = await requireInvitationAdministrator();
  const companyId = params.companyId.trim();
  if (!companyId) throw new Error("Company context is required");
  if (!canManageCompany(user, companyId)) {
    throw new Error("You can only invite users to your own company");
  }
  return sendOrganizationInvitation({ inviter: user, email: params.email, redirectUrl: params.redirectUrl, companyId });
}

export function isInvitationEmailConfigured(): boolean {
  return REQUIRED_ENV.every((name) => Boolean(process.env[name]?.trim()));
}

// Sends the Auth0 organization invitation email. No authorization of its
// own: callers must already have checked that the inviter may invite to
// `companyId` (createOrganizationInvitation above, or a client Admin's invite
// that Convex's team.createInvite has just accepted).
export async function sendOrganizationInvitation(params: {
  inviter: Pick<AppUser, "id" | "fullName" | "email">;
  email: string;
  redirectUrl: string;
  companyId: string;
}) {
  const config = getConfig();
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("A valid invitee email is required");
  }

  return managementRequest<OrganizationInvitation>(invitationsPath(config), {
    method: "POST",
    body: JSON.stringify({
      inviter: { name: params.inviter.fullName, email: params.inviter.email },
      invitee: { email: normalizedEmail },
      client_id: config.invitationClientId,
      connection_id: config.invitationConnectionId,
      ttl_sec: 7 * 24 * 60 * 60,
      send_invitation_email: true,
      // app_metadata is copied onto the user when the invitation is accepted;
      // the Post-Login Action emits companyId from it as a namespaced claim.
      app_metadata: { redirectUrl: params.redirectUrl, companyId: params.companyId, invitedBy: params.inviter.id },
    }),
  });
}

// Deletes an Auth0 invitation after the caller's own authorization (a client
// Admin revoking their team's invite in Convex). An invitation that is
// already gone (accepted or expired) is not an error.
export async function deleteOrganizationInvitation(invitationId: string) {
  const config = getConfig();
  const id = invitationId.trim();
  if (!id) return;
  try {
    await managementRequest<void>(invitationsPath(config, id), { method: "DELETE" });
  } catch (error) {
    if (error instanceof Auth0ManagementError && error.status === 404) return;
    throw error;
  }
}

export async function revokeOrganizationInvitation(invitationId: string) {
  const user = await requireInvitationAdministrator();
  const config = getConfig();
  const id = invitationId.trim();
  if (!id) throw new Error("Invitation ID is required");

  let invitation: OrganizationInvitation;
  try {
    invitation = await managementRequest<OrganizationInvitation>(invitationsPath(config, id));
  } catch (error) {
    if (error instanceof Auth0ManagementError && error.status === 404) {
      throw new Error("Invitation not found");
    }
    throw error;
  }

  const invitationCompanyId = invitation.app_metadata?.companyId;
  if (
    !canManageCompany(
      user,
      typeof invitationCompanyId === "string" ? invitationCompanyId : undefined,
    )
  ) {
    // Same message as a missing invitation so other companies' invitation IDs
    // cannot be probed.
    throw new Error("Invitation not found");
  }

  await managementRequest<void>(invitationsPath(config, id), { method: "DELETE" });
}

// ── Client single sign-on (enterprise connections) ─────────────────────────
// Callers must already have checked the user may manage the client's SSO
// (Convex sso.authorizeConnect / authorizeRemove). Needs these Management
// API scopes on the M2M app: create:connections, delete:connections and
// create:organization_connections.

export function isConnectionManagementConfigured(): boolean {
  return isInvitationEmailConfigured() && Boolean(process.env.AUTH0_CLIENT_ID?.trim());
}

export async function createEnterpriseConnection(params: {
  name: string;
  displayName: string;
  strategy: "waad" | "google-apps" | "samlp" | "oidc";
  options: Record<string, unknown>;
}): Promise<{ id: string }> {
  const config = getConfig();
  const appClientId = process.env.AUTH0_CLIENT_ID?.trim();
  if (!appClientId) throw new Error("AUTH0_CLIENT_ID is not set");
  const connection = await managementRequest<{ id: string }>("/api/v2/connections", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      display_name: params.displayName,
      strategy: params.strategy,
      options: params.options,
      enabled_clients: [appClientId],
    }),
  });
  // Members sign in through the shared Sentinel organization; the
  // connection must be enabled on it (and users added on first login).
  await managementRequest<unknown>(`/api/v2/organizations/${encodeURIComponent(config.organizationId)}/enabled_connections`, {
    method: "POST",
    body: JSON.stringify({ connection_id: connection.id, assign_membership_on_login: true, show_as_button: true }),
  });
  return { id: connection.id };
}

export async function deleteEnterpriseConnection(connectionId: string) {
  try {
    await managementRequest<void>(`/api/v2/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof Auth0ManagementError && error.status === 404) return;
    throw error;
  }
}

// Where the client's identity provider sends users back, and the SAML
// entity ID Auth0 uses for this connection.
export function ssoCallbackDetails(connectionName: string | null) {
  const domain = process.env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return null;
  const tenant = domain.split(".")[0];
  return {
    callbackUrl: `https://${domain}/login/callback`,
    samlAcsUrl: connectionName ? `https://${domain}/login/callback?connection=${connectionName}` : null,
    samlEntityId: connectionName ? `urn:auth0:${tenant}:${connectionName}` : null,
  };
}
