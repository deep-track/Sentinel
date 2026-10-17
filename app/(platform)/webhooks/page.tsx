export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { WebhooksPanel } from "@/components/developers/webhooks-panel";

export default async function WebhooksPage() {
  const { scope } = await requireActiveScope();
  const canManage = scope.role === "client_admin" || scope.role === "developer";
  const canResend = scope.role !== "viewer";
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Webhooks</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Get notified when a verification for {scope.clientName} completes</p>
      </div>
      <WebhooksPanel clientId={scope.clientId} canManage={canManage} canResend={canResend} />
    </div>
  );
}
