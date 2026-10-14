export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ReportsView } from "./reports-view";

// Compliance reports for the selected organization: the monthly pack and
// the STR register.
export default async function ReportsPage() {
  const { scope } = await requireActiveScope();
  const canSeePack = ["client_admin", "reviewer", "viewer"].includes(scope.role);
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto print:max-w-none print:p-0">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">The monthly compliance pack for {scope.clientName}, and your suspicious transaction reports.</p>
      </div>
      {canSeePack ? (
        <ReportsView clientId={scope.clientId} canSeeStrs={scope.role === "client_admin" || scope.role === "reviewer"} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Reports are for Admins, Reviewers and Auditors.</p>
      )}
    </div>
  );
}
