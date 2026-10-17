export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { ServiceHealth } from "./service-health";

// Back Office service health: probes, configuration and 7-day traffic for
// every external dependency. Reads need an internal role; re-running probes
// and resending webhooks need internal_admin without view_only (Convex
// enforces both again).
export default async function ServiceHealthPage() {
  const user = await getCurrentUser();
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <ServiceHealth canWrite={canWrite} />;
}
