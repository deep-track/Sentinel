export const dynamic = "force-dynamic";

import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { getActiveMembership } from "@/app/(platform)/_lib/active-client";
import type { CurrentAccess } from "@/app/(platform)/_lib/active-client-constants";
import { CreditUsageCard, type CreditSummary } from "./_components/credit-usage-card";
import { StatsGrid } from "./_components/stats-grid";
import { RecentVerificationsTable, type RecentVerification } from "./_components/recent-verifications-table";
import { VerificationBreakdown } from "./_components/verification-breakdown";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type Overview = {
  total: number;
  avgCompletionTimeMs: number | null;
  pendingReview: number;
  activeApiKeys: number;
  breakdown: { type: string; count: number; percentage: number }[];
  recent: RecentVerification[];
};

type DashboardData = {
  overview: Overview | null;
  overviewError?: string;
  credits: CreditSummary | null;
  creditsError?: string;
};

// Queries Convex directly with the signed-in user's token. (Previously this
// fetched its own /api routes server-side, which carry no session cookies
// and always came back empty.)
async function getDashboardData(): Promise<DashboardData> {
  const client = await getAuthenticatedConvexClient();
  if (!client) {
    return {
      overview: null,
      overviewError: "Your session couldn't be verified. Sign in again to load the dashboard.",
      credits: null,
    };
  }

  const overviewPromise = client
    .query(anyApi.dashboard.overview, { timeRangeMs: THIRTY_DAYS_MS, recentLimit: 10 })
    .then((overview: Overview) => ({ overview }))
    .catch((error: unknown) => {
      console.error("[dashboard] overview query failed", error);
      return { overview: null, overviewError: "Verification statistics are temporarily unavailable." };
    });

  const creditsPromise = (async () => {
    try {
      const access: CurrentAccess = await client.query(anyApi.dashboard.currentAccess, {});
      const scope = access.authorized ? await getActiveMembership(access.memberships) : null;
      if (!scope) return { credits: null, creditsError: "No organization is selected." };
      const balance: number = await client.query(anyApi.creditLedger.getBalanceForClient, {
        clientId: scope.clientId,
      });
      return { credits: { balance, clientName: scope.clientName } };
    } catch (error) {
      console.error("[dashboard] credit balance query failed", error);
      return { credits: null, creditsError: "Credit balance is temporarily unavailable." };
    }
  })();

  const [overviewResult, creditsResult] = await Promise.all([overviewPromise, creditsPromise]);
  return { ...overviewResult, ...creditsResult };
}

export default async function DashboardPage() {
  const { overview, overviewError, credits, creditsError } = await getDashboardData();

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Overview of verification activity across your organizations (last 30 days)
        </p>
      </div>

      <CreditUsageCard credits={credits} error={creditsError} />

      {overviewError ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-800 dark:text-red-300">
          {overviewError}
        </div>
      ) : null}

      {overview ? (
        <>
          <StatsGrid
            total={overview.total}
            avgCompletionTimeMs={overview.avgCompletionTimeMs}
            pendingReview={overview.pendingReview}
            activeApiKeys={overview.activeApiKeys}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <VerificationBreakdown data={overview.breakdown} />
            <RecentVerificationsTable data={overview.recent} />
          </div>
        </>
      ) : null}
    </div>
  );
}
