"use client";

import Link from "next/link";
import { anyApi } from "convex/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";

type Dispute = {
  _id: string;
  status: "open" | "decided" | "withdrawn";
  reason: string;
  disputedVerdict: "pass" | "reject" | null;
  expectedVerdict: "pass" | "reject" | null;
  createdAt: number;
  resolvedAt: number | null;
  outcome: { verdict: "pass" | "reject"; notes: string | null; decidedBy: string } | null;
  verification: { _id: string; reference: string; type: string; verdict: string | null; subject: string; href: string | null } | null;
};

const VERDICT_LABEL: Record<string, string> = { pass: "Pass", reject: "Rejected", review: "In review" };

function statusChip(dispute: Dispute) {
  if (dispute.status === "open") return { label: "With DeepTrack", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
  if (dispute.status === "withdrawn") return { label: "Withdrawn", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  const upheld = dispute.outcome && dispute.disputedVerdict && dispute.outcome.verdict !== dispute.disputedVerdict;
  return upheld
    ? { label: "Upheld", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" }
    : { label: "Not upheld", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" };
}

export function DisputesView({ clientId }: { clientId: string }) {
  const disputes = useAuthedQuery(anyApi.disputes.list, { clientId }) as Dispute[] | undefined;
  if (!disputes) return <Skeleton className="h-40 w-full" />;
  if (disputes.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No disputes yet.</p>;
  }
  const open = disputes.filter((dispute) => dispute.status === "open").length;
  return (
    <Card className="divide-y">
      <div className="px-4 py-3 text-sm text-muted-foreground">
        {open} open · {disputes.length - open} closed
      </div>
      {disputes.map((dispute) => {
        const chip = statusChip(dispute);
        return (
          <div key={dispute._id} className="flex flex-col gap-2 px-4 py-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {dispute.verification?.href ? (
                  <Link href={dispute.verification.href} className="font-medium hover:underline">
                    {dispute.verification.subject}
                  </Link>
                ) : (
                  <span className="font-medium">{dispute.verification?.subject ?? "Check"}</span>
                )}
                <span className="ml-2 font-mono text-xs text-muted-foreground">{dispute.verification?.reference}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}>{chip.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Disputed <ClientDate value={dispute.createdAt} />
              {dispute.disputedVerdict && dispute.expectedVerdict
                ? ` · result ${VERDICT_LABEL[dispute.disputedVerdict]}, expected ${VERDICT_LABEL[dispute.expectedVerdict]}`
                : ""}
            </p>
            <p className="whitespace-pre-wrap">{dispute.reason}</p>
            {dispute.outcome ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs">
                <span className="font-medium">
                  Decided by {dispute.outcome.decidedBy}
                  {dispute.resolvedAt ? (
                    <>
                      {" "}
                      on <ClientDate value={dispute.resolvedAt} />
                    </>
                  ) : null}
                  : final result {VERDICT_LABEL[dispute.outcome.verdict]}.
                </span>
                {dispute.outcome.notes ? <span className="block mt-1 whitespace-pre-wrap">{dispute.outcome.notes}</span> : null}
              </p>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
