export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { Compliance } from "./compliance";

// Back Office compliance: audit log, report sign-off, data subject requests and
// retention. Reads need an internal role; sign-off and request changes need
// internal_admin without view_only (Convex enforces both again).
export default async function CompliancePage() {
  const user = await getCurrentUser();
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <Compliance canWrite={canWrite} />;
}
