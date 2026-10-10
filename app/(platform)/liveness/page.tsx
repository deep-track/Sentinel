export const dynamic = "force-dynamic";

import { LivenessRequestPanel } from "./liveness-request-panel";
import { requireActiveScope } from "@/app/(platform)/_lib/active-client";

export default async function LivenessPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Liveness
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Send a liveness check to an end user&apos;s phone and review the
          result here. Requests are sent on behalf of {scope.clientName}.
        </p>
      </div>

      <LivenessRequestPanel clientId={scope.clientId} canSend={scope.role !== "viewer"} />
    </div>
  );
}
