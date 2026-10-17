"use server";

import { anyApi } from "convex/server";
import { getCurrentUser } from "@/backend/lib/auth";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import {
  deleteOrganizationInvitation,
  isInvitationEmailConfigured,
  sendOrganizationInvitation,
} from "@/backend/lib/auth0-management";
import { getErrorMessage } from "@/modules/shared/errors";

type Role = "client_admin" | "reviewer" | "compliance_analyst" | "developer" | "viewer";

export type InviteResult =
  | { ok: true; email: string; emailSent: boolean; note?: string }
  | { ok: false; error: string };

function appUrl(): string | null {
  const base = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return null;
  try {
    return new URL("/dashboard", base).toString();
  } catch {
    return null;
  }
}

// Invites a team member. Convex's team.createInvite decides whether the
// caller may (an active Admin of `clientId`, within the seat limit and the
// allowed email domains); only after it succeeds is the Auth0 invitation
// email sent. Without Auth0 invitations configured the invite still works:
// the person joins the first time they sign in with that email.
export async function inviteTeamMember(clientId: string, email: string, role: Role): Promise<InviteResult> {
  const [user, convex] = await Promise.all([getCurrentUser(), getAuthenticatedConvexClient()]);
  if (!user || !convex) return { ok: false, error: "Your session has expired. Sign in again." };

  let invite: { inviteId: string; email: string; previousAuth0InvitationId: string | null };
  try {
    invite = await convex.mutation(anyApi.team.createInvite, { clientId, email, role });
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "The invitation couldn't be created.") };
  }

  const redirectUrl = appUrl();
  if (!isInvitationEmailConfigured() || !redirectUrl) {
    await convex.mutation(anyApi.team.recordInviteEmail, { inviteId: invite.inviteId, sent: false }).catch(() => undefined);
    return {
      ok: true,
      email: invite.email,
      emailSent: false,
      note: "Invitation emails aren't set up on this deployment, so no email was sent. They join the first time they sign in to Sentinel with this email.",
    };
  }

  try {
    if (invite.previousAuth0InvitationId) {
      await deleteOrganizationInvitation(invite.previousAuth0InvitationId).catch(() => undefined);
    }
    const sent = await sendOrganizationInvitation({ inviter: user, email: invite.email, redirectUrl, companyId: clientId });
    await convex.mutation(anyApi.team.recordInviteEmail, { inviteId: invite.inviteId, sent: true, auth0InvitationId: sent.id });
    return { ok: true, email: invite.email, emailSent: true };
  } catch (error) {
    console.error("[team] invitation email failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    await convex.mutation(anyApi.team.recordInviteEmail, { inviteId: invite.inviteId, sent: false }).catch(() => undefined);
    return {
      ok: true,
      email: invite.email,
      emailSent: false,
      note: "The invitation is saved, but the email couldn't be sent. Ask them to sign in to Sentinel with this email to join, or resend later.",
    };
  }
}

export async function revokeTeamInvite(inviteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const convex = await getAuthenticatedConvexClient();
  if (!convex) return { ok: false, error: "Your session has expired. Sign in again." };
  let auth0InvitationId: string | null;
  try {
    ({ auth0InvitationId } = await convex.mutation(anyApi.team.revokeInvite, { inviteId }));
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "The invitation couldn't be revoked.") };
  }
  if (auth0InvitationId && isInvitationEmailConfigured()) {
    // The Convex invite is already revoked, so the link can't grant access
    // even if this fails.
    await deleteOrganizationInvitation(auth0InvitationId).catch((error) =>
      console.error("[team] Auth0 invitation delete failed", error instanceof Error ? error.message.slice(0, 200) : "unknown"),
    );
  }
  return { ok: true };
}
