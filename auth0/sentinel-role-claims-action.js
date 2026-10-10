/**
 * Sentinel Auth0 Post-Login Action
 *
 * Deploy and bind this Action to the Post Login trigger in the Sentinel
 * tenant. It emits only allowlisted, normalized roles from
 * event.authorization.roles, plus the admin-controlled app_metadata.companyId.
 * It never trusts user_metadata or request data.
 *
 * Claims (ID token and access token):
 *   https://deeptrack.io/roles      string[]  canonical role claim
 *   https://deeptrack.io/role       string    legacy: highest-privilege role
 *   https://deeptrack.io/companyId  string    only when app_metadata.companyId is set
 *
 * The allowlist must stay in sync with backend/convex/lib/rbac.ts and
 * backend/lib/roles.ts.
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://deeptrack.io";

  // Highest privilege first; used only to pick the legacy singular claim.
  const priority = [
    "internal_admin",
    "administrator",
    "head",
    "admin",
    "reviewer",
    "compliance_analyst",
    "compliance_reviewer",
    "view_only",
  ];
  const allowed = new Set(priority);

  const normalize = (value) => String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const assignedRoles = Array.isArray(event.authorization?.roles)
    ? event.authorization.roles
    : [];
  const roles = [...new Set(assignedRoles.map(normalize).filter((role) => allowed.has(role)))];
  const primaryRole = priority.find((role) => roles.includes(role)) ?? "";

  // The application can still authenticate users with no internal role, but
  // Sentinel Convex internal operations will deny them fail-closed.
  api.idToken.setCustomClaim(`${namespace}/roles`, roles);
  api.accessToken.setCustomClaim(`${namespace}/roles`, roles);
  api.idToken.setCustomClaim(`${namespace}/role`, primaryRole);
  api.accessToken.setCustomClaim(`${namespace}/role`, primaryRole);

  // app_metadata is writable only by tenant administrators and the
  // Management API (organization invitations copy it onto the new user).
  const companyId = event.user?.app_metadata?.companyId;
  if (typeof companyId === "string" && companyId.trim()) {
    api.idToken.setCustomClaim(`${namespace}/companyId`, companyId.trim());
    api.accessToken.setCustomClaim(`${namespace}/companyId`, companyId.trim());
  }
};
