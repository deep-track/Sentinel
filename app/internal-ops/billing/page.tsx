export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { Billing } from "./billing";

// Back Office revenue and billing. Reads need an internal role; editing
// prices needs internal_admin without view_only (Convex enforces both again).
export default async function BillingPage() {
  const user = await getCurrentUser();
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <Billing canWrite={canWrite} />;
}
