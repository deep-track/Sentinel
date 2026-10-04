import { Card } from "@/components/ui/card";
import { anyApi } from "convex/server";
import { redirect } from "next/navigation";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { WebhookCreateDialog } from "./webhook-create-dialog";

// There's currently no public Convex query that returns a client's
// configured webhookUrl, delivery history, or failure counts — only the
// one-shot registerWebhook mutation (sets/rotates the URL) and
// resendWebhook (needs a deliveryId the client has no way to discover).
// So this page can't show what's currently configured or past deliveries
// — that needs a new backend query (e.g. webhooks.getForClient returning
// { webhookUrl, recentDeliveries }) before this page can show real status
// instead of just the set/rotate action.

export default async function WebhooksPage() {
  const client = await getAuthenticatedConvexClient();
  if (!client) redirect("/access-pending?reason=authorization-unavailable");
  const access = await client.query(anyApi.dashboard.currentAccess, {});
  const scope = access.memberships[0];
  if (!access.authorized || !scope) redirect("/access-pending");

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Webhooks
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Get notified when a verification completes
          </p>
        </div>
        <WebhookCreateDialog clientId={scope.clientId} />
      </div>

      <Card className="p-6 border-dashed">
        <p className="text-sm text-muted-foreground">
          Viewing your currently-configured webhook and delivery history isn&apos;t available
          yet — use &quot;Set webhook&quot; to configure or rotate your endpoint. Each call
          replaces the previous URL and issues a new signing secret.
        </p>
      </Card>
    </div>
  );
}