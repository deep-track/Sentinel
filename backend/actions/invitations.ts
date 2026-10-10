"use server";

import {
  createOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/backend/lib/auth0-management";

function validateRedirectUrl(redirectUrl: string) {
  const appBaseUrl = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!appBaseUrl) throw new Error("Application base URL is not configured");

  const target = new URL(redirectUrl, appBaseUrl);
  const base = new URL(appBaseUrl);
  if (target.origin !== base.origin) {
    throw new Error("Invitation redirect must remain on the application origin");
  }
  return target.toString();
}

// Company scoping is enforced in backend/lib/auth0-management.ts: the caller
// must be an invitation administrator for `companyId` (internal_admin may act
// for any company), and revocation verifies the invitation's stored companyId.
export async function revokeInvitation(invitationId: string) {
  if (typeof invitationId !== "string") throw new Error("Invitation ID is required");
  await revokeOrganizationInvitation(invitationId);
  return { success: true };
}

export async function createInvitation(
  email: string,
  redirectUrl: string,
  role: "admin" | "user",
  companyId: string,
) {
  if (role !== "user") {
    throw new Error("Only standard user invitations are enabled");
  }
  if (typeof companyId !== "string" || !companyId.trim()) {
    throw new Error("Company context is required");
  }
  if (typeof email !== "string" || typeof redirectUrl !== "string") {
    throw new Error("A valid invitee email and redirect URL are required");
  }

  return createOrganizationInvitation({
    email,
    redirectUrl: validateRedirectUrl(redirectUrl),
    companyId,
  });
}
