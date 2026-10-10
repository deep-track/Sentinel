// Shared between the server-side active-organization resolver and the
// client-side organization switcher. Kept free of server-only imports so it
// can be bundled into client components.

/**
 * Cookie holding the clientId of the organization the user is currently
 * acting on. It is a UI preference, not a credential: every server read
 * re-validates it against the user's Convex memberships, and every Convex
 * mutation re-checks membership with `requireClientRole`.
 */
export const ACTIVE_CLIENT_COOKIE = "sentinel_client_id";

export type ClientRole = "client_admin" | "compliance_analyst" | "developer" | "viewer";

export type ClientMembership = {
  clientId: string;
  clientName: string;
  clientStatus: string;
  role: ClientRole;
};

export type CurrentAccess = {
  authorized: boolean;
  memberships: ClientMembership[];
};

/**
 * Picks the selected membership when it is still one the user holds,
 * otherwise falls back to the first membership.
 */
export function pickActiveMembership(
  memberships: ClientMembership[],
  selectedClientId: string | null | undefined,
): ClientMembership | null {
  if (selectedClientId) {
    const selected = memberships.find((membership) => membership.clientId === selectedClientId);
    if (selected) return selected;
  }
  return memberships[0] ?? null;
}
