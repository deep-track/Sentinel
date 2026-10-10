import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { anyApi } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { getConvexClientForCurrentUser } from "@/backend/lib/convex-server";
import {
  ACTIVE_CLIENT_COOKIE,
  type ClientMembership,
  type CurrentAccess,
  pickActiveMembership,
} from "./active-client-constants";

/** Resolves the active membership from the selection cookie (validated against `memberships`). */
export async function getActiveMembership(
  memberships: ClientMembership[],
): Promise<ClientMembership | null> {
  const store = await cookies();
  return pickActiveMembership(memberships, store.get(ACTIVE_CLIENT_COOKIE)?.value);
}

export type ActiveScope = {
  client: ConvexHttpClient;
  scope: ClientMembership;
  memberships: ClientMembership[];
};

/**
 * For pages that act on exactly one organization (API keys, webhooks,
 * liveness, new verifications…). Returns the authenticated Convex client and
 * the organization the user selected in the sidebar switcher, or redirects
 * when the user has no usable membership.
 */
export async function requireActiveScope(): Promise<ActiveScope> {
  const connection = await getConvexClientForCurrentUser();
  if (connection.status === "unauthenticated") redirect("/auth/login");
  if (connection.status !== "ok") redirect("/access-pending?reason=authorization-unavailable");
  const client = connection.client;

  let access: CurrentAccess;
  try {
    access = await client.query(anyApi.dashboard.currentAccess, {});
  } catch (error) {
    console.error("[active-client] currentAccess query failed", error);
    redirect("/access-pending?reason=authorization-unavailable");
  }

  const scope = access.authorized ? await getActiveMembership(access.memberships) : null;
  if (!scope) redirect("/access-pending");

  return { client, scope, memberships: access.memberships };
}
