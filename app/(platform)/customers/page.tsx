export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { CustomersView } from "./customers-view";

// Monitored customers with their risk rating and periodic review dates.
export default async function CustomersPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Customer risk</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every customer under ongoing monitoring, rated low, medium or high risk from their geography, PEP status, screening hits, type and industry. High-risk customers are reviewed most often (set the periods in Settings → Screening).
        </p>
      </div>
      <CustomersView clientId={scope.clientId} />
    </div>
  );
}
