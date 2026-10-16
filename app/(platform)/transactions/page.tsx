export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { TransactionsView } from "./transactions-view";

export default async function TransactionsPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Transaction monitoring</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Send your customers&apos; transactions (CSV here, or the API at POST /v1/transactions). Sentinel checks each customer&apos;s history for large cash,
          structuring, unusual activity, high-risk countries, money passing straight through, dormant accounts waking up and sanctioned counterparties.
          Alerts land here for your team to close or escalate.
        </p>
      </div>
      <TransactionsView clientId={scope.clientId} canUpload={scope.role !== "viewer"} />
    </div>
  );
}
