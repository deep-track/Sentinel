export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { requestIp } from "@/app/(platform)/_lib/request-ip";
import { SecuritySettings } from "./security-settings";

export default async function SecuritySettingsPage() {
  const [{ scope }, currentIp] = await Promise.all([requireActiveScope(), requestIp()]);
  return <SecuritySettings clientId={scope.clientId} currentIp={currentIp} />;
}
