"use server";

import { cookies } from "next/headers";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { ACTIVE_CLIENT_COOKIE, type CurrentAccess } from "./active-client-constants";

export type SetActiveClientResult = { ok: true } | { ok: false; error: string };

/**
 * Stores the organization the user wants to act on. The id is checked against
 * the user's current memberships before it is written, so the cookie can only
 * ever name an organization the user belongs to.
 */
export async function setActiveClient(clientId: string): Promise<SetActiveClientResult> {
  if (typeof clientId !== "string" || !clientId.trim()) {
    return { ok: false, error: "Choose an organization." };
  }

  const client = await getAuthenticatedConvexClient();
  if (!client) return { ok: false, error: "Your session has expired. Sign in again to switch organizations." };

  try {
    const access: CurrentAccess = await client.query(anyApi.dashboard.currentAccess, {});
    if (!access.memberships.some((membership) => membership.clientId === clientId)) {
      return { ok: false, error: "You don't have access to that organization." };
    }
  } catch (error) {
    console.error("[active-client] membership check failed", error);
    return { ok: false, error: "Couldn't verify your access to that organization. Try again." };
  }

  const store = await cookies();
  store.set(ACTIVE_CLIENT_COOKIE, clientId, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Readable by the sidebar switcher so it can show the current selection.
    // It only names an organization; access is enforced server-side.
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
