export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ApiKeysPanel } from "@/components/developers/api-keys-panel";
import { WebhooksPanel } from "@/components/developers/webhooks-panel";

// Settings → Developers: API keys and the webhook (also on their own pages
// under Developer in the sidebar).
export default async function DevelopersSettingsPage() {
  const { scope } = await requireActiveScope();
  const canManage = scope.role === "client_admin" || scope.role === "developer";
  const canResend = scope.role !== "viewer";
  return (
    <>
      <ApiKeysPanel clientId={scope.clientId} canManage={canManage} />
      <WebhooksPanel clientId={scope.clientId} canManage={canManage} canResend={canResend} />
    </>
  );
}
