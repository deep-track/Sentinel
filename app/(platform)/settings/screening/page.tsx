export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ScreeningSettings } from "./screening-settings";

export default async function ScreeningSettingsPage() {
  const { scope } = await requireActiveScope();
  return <ScreeningSettings clientId={scope.clientId} />;
}
