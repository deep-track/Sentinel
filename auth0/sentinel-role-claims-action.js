/**
 * Sentinel Auth0 Post-Login Action
 *
 * Deploy and bind this Action to the Post Login trigger in the Sentinel
 * development tenant. It intentionally emits only normalized roles from
 * event.authorization.roles; it does not trust user_metadata or request data.
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://deeptrack.io";
  const allowed = new Set([
    "admin",
    "head",
    "administrator",
    "internal_admin",
    "reviewer",
    "compliance_analyst",
    "compliance_reviewer",
  ]);

  const normalize = (value) => String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const assignedRoles = Array.isArray(event.authorization?.roles)
    ? event.authorization.roles
    : [];
  const roles = [...new Set(assignedRoles.map(normalize).filter((role) => allowed.has(role)))];

  // The application can still authenticate users with no internal role, but
  // Sentinel Convex internal operations will deny them fail-closed.
  api.idToken.setCustomClaim(`${namespace}/roles`, roles);
  api.accessToken.setCustomClaim(`${namespace}/roles`, roles);
  api.idToken.setCustomClaim(`${namespace}/role`, roles[0] ?? "");
  api.accessToken.setCustomClaim(`${namespace}/role`, roles[0] ?? "");
};
