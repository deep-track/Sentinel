export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { RiskLists } from "./risk-lists";

// Back Office: Kenyan enforcement, debarment and wanted lists (riskLists.ts).
export default async function RiskListsPage() {
  const user = await getCurrentUser();
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <RiskLists canWrite={canWrite} />;
}
