export const dynamic = "force-dynamic";

import Link from "next/link";
import { CreditUsageCard } from "./_components/credit-usage-card";
import { StatsGrid } from "./_components/stats-grid";
import { RecentVerificationsTable } from "./_components/recent-verifications-table";
import { AlertCircle } from "lucide-react";

// NOTE: getKYCStats, getKYCList, getKYIStats, and getAPIKeys previously
// came from actions/kyc.ts, actions/kyi.ts, and actions/api-keys.ts.
// Those files were removed as part of the Convex backend migration, and
// there are currently no public Convex queries that replace them
// (confirmed: convex/kyb.ts is empty, and no listKYC/listKYI/statsKYC/
// statsKYI/listApiKeys query exists yet in convex/*.ts). This page shows
// honest empty states below until Stacy adds the equivalent Convex
// queries. Do not fabricate data here.

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
        activeApiKeys={0}
      />

      <RecentVerificationsTable data={verificationsRes?.verifications ?? []} />

      <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-6 flex gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            KYC / KYI breakdown and recent activity are temporarily unavailable
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/80">
            These previously came from actions that were removed during the
            Convex migration. They&apos;ll return once the equivalent Convex
            queries exist. See{" "}
            <Link href="/kyc" className="underline">
              KYC
            </Link>{" "}
            and{" "}
            <Link href="/kyi" className="underline">
              KYI
            </Link>{" "}
            directly in the meantime.
          </p>
        </div>
      </div>
    </div>
  );
}