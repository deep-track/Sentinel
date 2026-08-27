import { LivenessRequestPanel } from "./liveness-request-panel";
import { anyApi } from "convex/server";
import { redirect } from "next/navigation";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

export default async function LivenessPage() {
  const client = await getAuthenticatedConvexClient();
  if (!client) redirect("/access-pending?reason=authorization-unavailable");
  const access = await client.query(anyApi.dashboard.currentAccess, {});
  const scope = access.memberships[0];
  if (!access.authorized || !scope) redirect("/access-pending");
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Liveness
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Send a liveness check to an end user&apos;s phone and review the
          result here
        </p>
      </div>

      <LivenessRequestPanel clientId={scope.clientId} />
    </div>
  );
}