export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ApiKeysPanel } from "@/components/developers/api-keys-panel";

export default async function ApiKeysPage() {
  const { scope } = await requireActiveScope();
  const canManage = scope.role === "client_admin" || scope.role === "developer";
  return (
    <div className="space-y-4 p-6 lg:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-muted-foreground">Keys for {scope.clientName}, with the scopes each integration needs.</p>
      </div>
      <ApiKeysPanel clientId={scope.clientId} canManage={canManage} />
    </div>
  );
}
