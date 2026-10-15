"use server";

import { headers } from "next/headers";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { isInvitationEmailConfigured, sendOrganizationInvitation } from "@/backend/lib/auth0-management";
import { getErrorMessage } from "@/modules/shared/errors";

export type SignupResult = { ok: true; emailSent: boolean; email: string; existingTrial: boolean } | { ok: false; error: string };

// Only light per-instance protection: Convex limits requests per email and per day.
const recent = new Map<string, number[]>();
function tooManyFrom(ip: string, now: number) {
  const hits = (recent.get(ip) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > 10;
}

function trialUrl(): string | null {
  const base = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return null;
  try {
    return new URL("/access-pending", base).toString();
  } catch {
    return null;
  }
}

// The public sign-up form: stores the request in Convex (which validates
// it), then sends the Auth0 invitation so the person can set a password.
export async function requestSignup(input: { name: string; email: string; company: string; country: string; website?: string }): Promise<SignupResult> {
  // Honeypot field, hidden from people.
  if (input.website) return { ok: true, emailSent: true, email: input.email, existingTrial: false };
  const forwarded = (await headers()).get("x-forwarded-for") ?? "unknown";
  if (tooManyFrom(forwarded.split(",")[0].trim(), Date.now())) return { ok: false, error: "Too many attempts. Try again in an hour." };
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return { ok: false, error: "Sign-up isn't available right now." };

  let created: { requestId: string; existingTrial: boolean };
  try {
    created = await new ConvexHttpClient(convexUrl).mutation(anyApi.signups.request, { name: input.name, email: input.email, company: input.company, country: input.country });
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "Your request couldn't be saved.") };
  }
  const email = input.email.trim().toLowerCase();
  const redirectUrl = trialUrl();
  if (!isInvitationEmailConfigured() || !redirectUrl) return { ok: true, emailSent: false, email, existingTrial: created.existingTrial };
  try {
    await sendOrganizationInvitation({ inviter: { id: "self-service", fullName: "Sentinel by DeepTrack", email: "sales@deeptrack.io" }, email, redirectUrl, companyId: "self_service" });
    return { ok: true, emailSent: true, email, existingTrial: created.existingTrial };
  } catch (error) {
    console.error("[signup] invitation failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return { ok: true, emailSent: false, email, existingTrial: created.existingTrial };
  }
}
