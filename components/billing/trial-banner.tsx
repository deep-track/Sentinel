"use client";

import Link from "next/link";
import { anyApi } from "convex/server";
import { useAuthedQuery } from "@/hooks/use-authed-query";

// Shown in a trial workspace: days and credits left, or that it ended.
export function TrialBanner({ clientId }: { clientId: string }) {
  const trial = useAuthedQuery(anyApi.signups.trialBanner, { clientId }) as { expired: boolean; daysLeft: number | null; balance: number } | null | undefined;
  if (!trial) return null;
  return (
    <div className={`px-8 py-2 text-sm print:hidden ${trial.expired ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" : "bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-200"}`}>
      {trial.expired ? (
        <>Your free trial has ended, so new checks are paused. Your results and settings are kept. </>
      ) : (
        <>
          Free trial: {trial.daysLeft === null ? "" : `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} and `}
          {trial.balance.toLocaleString("en-US")} credit{trial.balance === 1 ? "" : "s"} left.{" "}
        </>
      )}
      <Link href="/billing" className="font-medium underline">
        {trial.expired ? "Top up to continue" : "Top up to keep going after the trial"}
      </Link>
    </div>
  );
}
