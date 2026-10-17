"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// Removal of checks and transactions past the retention period: one Admin
// requests it, a second Admin (or DeepTrack) approves, then Sentinel removes
// the personal data in the background (backend/convex/retention.ts).

type Purge = {
  _id: string;
  status: "pending_approval" | "running" | "completed" | "cancelled";
  retentionMonths: number;
  cutoff: number;
  estimated: number;
  estimateCapped: boolean;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  approvedByName: string | null;
  approvedAt: number | null;
  cancelledAt: number | null;
  purged: number;
  held: number;
  holds: { openCase: number; monitoring: number; str: number; unfinished: number };
  relatedRemoved: number;
  estimatedTransactions: number;
  transactions: { removed: number; held: number; alertsTrimmed: number; alertsMinimized: number; screeningsRemoved: number };
  completedAt: number | null;
};

type Overview = {
  retentionMonths: number;
  cutoff: number;
  pastRetention: number;
  pastRetentionCapped: boolean;
  pastRetentionTransactions: number;
  pastRetentionTransactionsCapped: boolean;
  purges: Purge[];
  me: { userId: string; canRequest: boolean };
};

const count = (value: number, capped = false) => `${capped ? "More than " : ""}${value.toLocaleString("en-US")}`;

function holdText(holds: Purge["holds"]) {
  const parts = [
    holds.openCase ? `${holds.openCase} with an open case or dispute` : null,
    holds.monitoring ? `${holds.monitoring} under active monitoring` : null,
    holds.str ? `${holds.str} with an STR` : null,
    holds.unfinished ? `${holds.unfinished} not finished` : null,
  ].filter(Boolean);
  return parts.length ? `Kept: ${parts.join(", ")}.` : "";
}

function transactionsText(transactions: Purge["transactions"]) {
  if (!transactions.removed && !transactions.held && !transactions.screeningsRemoved) return "";
  return [
    `Removed ${transactions.removed.toLocaleString("en-US")} transaction${transactions.removed === 1 ? "" : "s"}`,
    transactions.held ? `kept ${transactions.held.toLocaleString("en-US")} on open alerts` : null,
    transactions.alertsMinimized ? `reduced ${transactions.alertsMinimized.toLocaleString("en-US")} decided alerts to a minimal record` : null,
    transactions.screeningsRemoved ? `removed ${transactions.screeningsRemoved.toLocaleString("en-US")} counterparty screenings` : null,
  ]
    .filter(Boolean)
    .join(", ")
    .concat(".");
}

export function RetentionRemoval({ clientId }: { clientId: string }) {
  const data = useAuthedQuery(anyApi.retention.overview, { clientId }) as Overview | undefined;
  const requestRemoval = useMutation(anyApi.retention.request);
  const approve = useMutation(anyApi.retention.approve);
  const cancel = useMutation(anyApi.retention.cancel);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return null;
  const active = data.purges.find((purge) => purge.status === "pending_approval" || purge.status === "running") ?? null;
  const history = data.purges.filter((purge) => purge !== active);
  const nothingPast = data.pastRetention === 0 && data.pastRetentionTransactions === 0;

  const run = async (key: string, action: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(getErrorMessage(error, fallback));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {nothingPast ? (
          <>No checks or transactions are past the retention period.</>
        ) : (
          <>
            {count(data.pastRetention, data.pastRetentionCapped)} check{data.pastRetention === 1 ? "" : "s"} and {count(data.pastRetentionTransactions, data.pastRetentionTransactionsCapped)}{" "}
            transaction{data.pastRetentionTransactions === 1 ? "" : "s"} are older than <ClientDate value={data.cutoff} format="PP" /> ({data.retentionMonths} months).
          </>
        )}
      </p>

      {active ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/10">
          {active.status === "pending_approval" ? (
            <>
              <p className="font-medium">Removal waiting for approval</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {active.requestedByName} asked on <ClientDate value={active.requestedAt} format="PP" /> to remove {count(active.estimated, active.estimateCapped)} check
                {active.estimated === 1 ? "" : "s"} and {count(active.estimatedTransactions)} transaction{active.estimatedTransactions === 1 ? "" : "s"} from before{" "}
                <ClientDate value={active.cutoff} format="PP" />. Another Admin, or DeepTrack, must approve. Checks with an open case, active monitoring or an STR, and
                transactions on an open alert, are kept.
              </p>
              {data.me.canRequest ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {active.requestedBy !== data.me.userId ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm("Approve the removal? The personal data in these checks will be deleted and can't be recovered.")) return;
                        void run("approve", () => approve({ purgeId: active._id }), "Removal approved. It runs in the background.", "Couldn't approve the removal.");
                      }}
                    >
                      {busy === "approve" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                      Approve removal
                    </Button>
                  ) : (
                    <span className="self-center text-xs text-muted-foreground">You asked for this removal, so someone else must approve it.</span>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("cancel", () => cancel({ purgeId: active._id }), "Removal cancelled", "Couldn't cancel the removal.")}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="font-medium">
              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
              Removing personal data: {active.purged.toLocaleString("en-US")} checks so far.
            </p>
          )}
        </div>
      ) : data.me.canRequest && !nothingPast ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => {
            if (!window.confirm("Ask to remove the checks and transactions past the retention period? A second Admin, or DeepTrack, must approve before anything is deleted.")) return;
            void run("request", () => requestRemoval({ clientId }), "Removal requested. Another Admin must approve it.", "Couldn't request the removal.");
          }}
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Request removal
        </Button>
      ) : null}

      {history.length ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Removal history</p>
          <ul className="mt-1 divide-y rounded-lg border">
            {history.map((purge) => (
              <li key={purge._id} className="px-3 py-2 text-xs">
                {purge.status === "completed" ? (
                  <>
                    <span className="font-medium">
                      Removed {purge.purged.toLocaleString("en-US")} check{purge.purged === 1 ? "" : "s"}
                    </span>{" "}
                    created before <ClientDate value={purge.cutoff} format="PP" />, on <ClientDate value={purge.completedAt} format="PP" />. Requested by{" "}
                    {purge.requestedByName}, approved by {purge.approvedByName}. {holdText(purge.holds)} {transactionsText(purge.transactions)}
                  </>
                ) : (
                  <>
                    <span className="font-medium">Cancelled</span> request by {purge.requestedByName} from <ClientDate value={purge.requestedAt} format="PP" />.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
