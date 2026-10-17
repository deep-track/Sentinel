export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { DisputesView } from "./disputes-view";

// Results the team disputed with DeepTrack, and what DeepTrack decided.
export default async function DisputesPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Disputes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Results {scope.clientName} disputed, and DeepTrack&apos;s decisions. To dispute a result, open the check and choose &ldquo;Dispute this result&rdquo;.
          Results can be disputed for 90 days.
        </p>
      </div>
      <DisputesView clientId={scope.clientId} />
    </div>
  );
}
