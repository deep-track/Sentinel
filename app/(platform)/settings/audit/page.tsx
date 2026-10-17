export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { AuditView } from "./audit-view";

export default async function AuditSettingsPage() {
  const { scope } = await requireActiveScope();
  return <AuditView clientId={scope.clientId} role={scope.role} />;
}
