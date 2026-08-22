export const dynamic = "force-dynamic";

import { CreditUsageCard } from "./_components/credit-usage-card";
import { StatsGrid } from "./_components/stats-grid";
import { RecentVerificationsTable } from "./_components/recent-verifications-table";
import { VerificationBreakdown } from "./_components/verification-breakdown";

export default async function DashboardPage() {
  const [statsRes, verificationsRes] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/client/verifications/stats?timeRange=30d`, {
      cache: "no-store",
    }).then((r) => r.json()).catch(() => null),
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/client/verifications?limit=10`, {
      cache: "no-store",
    }).then((r) => r.json()).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Overview of all verification activity
        </p>
      </div>

      <CreditUsageCard />

      <StatsGrid
        total={statsRes?.total ?? 0}
        avgCompletionTimeMs={statsRes?.avgCompletionTimeMs ?? null}
        pendingReview={statsRes?.pendingReview ?? 0}
        activeApiKeys={statsRes?.activeApiKeys ?? 0}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <VerificationBreakdown data={statsRes?.breakdown ?? []} />
        <RecentVerificationsTable data={verificationsRes?.verifications ?? []} />
      </div>
    </div>
  );
}
