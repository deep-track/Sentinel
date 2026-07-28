export const dynamic = "force-dynamic";

import Link from "next/link";
import { getKYCStats, getKYCList } from "@/actions/kyc";
import { getKYIStats } from "@/actions/kyi";
import { getAPIKeys } from "@/actions/api-keys";
import { CreditUsageCard } from "./_components/credit-usage-card";
import { StatsGrid } from "./_components/stats-grid";
import { RecentVerificationsTable } from "./_components/recent-verifications-table";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Users,
  TrendingUp,
} from "lucide-react";

export default async function DashboardPage() {
  const [kycStatsResult, kyiStatsResult, kycListResult, statsRes, verificationsRes, apiKeys] =
    await Promise.all([
      getKYCStats(),
      getKYIStats(),
      getKYCList({ limit: 10 }),
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/client/verifications/stats?timeRange=30d`, {
        cache: "no-store",
      }).then((r) => r.json()),
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/client/verifications?limit=10`, {
        cache: "no-store",
      }).then((r) => r.json()),
      getAPIKeys(),
    ]);

  const kycStats = kycStatsResult.success ? kycStatsResult.data : null;
  const kyiStats = kyiStatsResult.success ? kyiStatsResult.data : null;
  const recentKYC = kycListResult.success ? kycListResult.data.records : [];

  const totalVerifications =
    (kycStats?.total ?? 0) + (kyiStats?.total ?? 0);
  const totalApproved =
    (kycStats?.approved ?? 0) + (kyiStats?.approved ?? 0);
  const totalDeclined =
    (kycStats?.declined ?? 0) + (kyiStats?.declined ?? 0);
  const totalPending =
    (kycStats?.pending ?? 0) +
    (kycStats?.processing ?? 0) +
    (kyiStats?.pending ?? 0) +
    (kyiStats?.processing ?? 0);
  const totalNeedsReview =
    (kycStats?.requires_review ?? 0) + (kyiStats?.requires_review ?? 0);

  const conversionRate =
    totalVerifications > 0
      ? Math.round((totalApproved / totalVerifications) * 100)
      : 0;

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
        total={statsRes.total ?? 0}
        avgCompletionTimeMs={statsRes.avgCompletionTimeMs ?? null}
        pendingReview={statsRes.pendingReview ?? 0}
        activeApiKeys={apiKeys.length}
      />

      <RecentVerificationsTable data={verificationsRes.verifications ?? []} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Users className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalVerifications.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Total Verifications
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalApproved.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Approved
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Clock className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalPending.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pending
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalNeedsReview.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Needs Review
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalDeclined.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Declined
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {conversionRate}%
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Conversion Rate
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              KYC Overview
            </h2>
           <Link
  href="/kyc"
  className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
>
  View all →
</Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total", value: kycStats?.total ?? 0 },
              { label: "Approved", value: kycStats?.approved ?? 0 },
              { label: "Declined", value: kycStats?.declined ?? 0 },
              { label: "Processing", value: kycStats?.processing ?? 0 },
              { label: "Needs Review", value: kycStats?.requires_review ?? 0 },
              { label: "Pending", value: kycStats?.pending ?? 0 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"
              >
                <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                  {item.value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              KYI Overview
            </h2>
            <Link
              href="/kyi"
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total", value: kyiStats?.total ?? 0 },
              { label: "Approved", value: kyiStats?.approved ?? 0 },
              { label: "Declined", value: kyiStats?.declined ?? 0 },
              { label: "Processing", value: kyiStats?.processing ?? 0 },
              { label: "Needs Review", value: kyiStats?.requires_review ?? 0 },
              { label: "PEP Count", value: kyiStats?.pepCount ?? 0 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"
              >
                <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                  {item.value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            Recent KYC Activity
          </h2>
          <Link
            href="/kyc"
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            View all →
          </Link>
        </div>

        {recentKYC.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 dark:text-slate-500 text-sm">
              No verifications yet
            </p>
            <Link
              href="/kyc/new"
              className="mt-3 inline-block text-xs text-violet-600 dark:text-violet-400 hover:underline"
            >
              Start your first verification →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {recentKYC.map((record) => (
              <Link
                key={record.id}
                href={`/kyc/${record.id}`}
                className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-2 -mx-2 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                      {(record.userName || record.userEmail || "?")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {record.userName || record.userEmail || "Unknown"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {record.documentType?.replace("_", " ")} ·{" "}
                      {record.reference?.slice(0, 20)}...
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      record.status === "approved"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : record.status === "declined"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : record.status === "processing"
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}