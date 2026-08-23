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

export async function revokeInvitation(invitationId: string) {
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
  if (!companyId.trim()) {
    throw new Error("Company context is required");
  }

  return createOrganizationInvitation(email, validateRedirectUrl(redirectUrl));
}
