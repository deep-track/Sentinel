export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { ClientAccounts } from "./client-accounts";

// Client account management (internal). Reads need an internal role; edits
// need internal_admin without view_only. Convex enforces both again.
export default async function ClientAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <ClientAccounts canWrite={canWrite} initialClientId={params.client ?? null} />;
}
