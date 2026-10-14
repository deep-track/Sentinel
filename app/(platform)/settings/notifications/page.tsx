export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { NotificationSettings } from "./notification-settings";

export default async function NotificationSettingsPage() {
  const { scope } = await requireActiveScope();
  return <NotificationSettings clientId={scope.clientId} />;
}
