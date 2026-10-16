export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/backend/lib/auth";
import { isInternalAdminRole } from "@/backend/lib/roles";
import { PepRegister } from "./pep-register";

// Back Office: Sentinel's Kenyan PEP register (pepRegister.ts).
export default async function PepRegisterPage() {
  const user = await getCurrentUser();
  const canWrite = Boolean(user && isInternalAdminRole(user.role) && !user.viewOnly);
  return <PepRegister canWrite={canWrite} />;
}
