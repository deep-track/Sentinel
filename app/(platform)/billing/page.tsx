export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { BillingView } from "./billing-view";

// Billing & credits for the organization selected in the sidebar: plan,
// balance, prices and the full credit history (creditLedger.billingForClient).
export default async function BillingPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Billing &amp; Credits</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Plan, balance, prices and credit history for {scope.clientName}
        </p>
      </div>
      <BillingView clientId={scope.clientId} />
    </div>
  );
}
