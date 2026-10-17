"use client";

import { useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { CategoryBadge, PriorityBadge, DueLabel, type ReviewSummary } from "./review-parts";

type View = "mine" | "unassigned" | "awaiting_approval" | "overdue" | "open" | "resolved";
type Counts = { open: number; mine: number; unassigned: number; awaitingApproval: number; overdue: number };

const VIEWS: Array<{ value: View; label: string; count?: keyof Counts }> = [
  { value: "mine", label: "Assigned to me", count: "mine" },
  { value: "unassigned", label: "Unassigned", count: "unassigned" },
  { value: "awaiting_approval", label: "Awaiting my approval", count: "awaitingApproval" },
  { value: "overdue", label: "Overdue", count: "overdue" },
  { value: "open", label: "All open", count: "open" },
  { value: "resolved", label: "Closed" },
];

const QUEUES = [
  { value: "", label: "All queues" },
  { value: "kyc", label: "KYC" },
  { value: "aml", label: "AML" },
  { value: "idp", label: "Documents (IDP)" },
  { value: "kyb", label: "KYB" },
  { value: "liveness", label: "Liveness" },
];

export function ReviewQueue({ clientId }: { clientId: string }) {
  const [view, setView] = useState<View>("open");
  const [queue, setQueue] = useState("");
  const counts = useAuthedQuery(anyApi.clientReviews.counts, { clientId }) as Counts | undefined;
  const rows = useAuthedQuery(anyApi.clientReviews.list, { clientId, view, ...(queue ? { queue } : {}) }) as ReviewSummary[] | undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((option) => {
          const count = option.count && counts ? counts[option.count] : null;
          const active = view === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {option.label}
              {count !== null ? <span className={`ml-1.5 text-xs ${option.value === "overdue" && count > 0 && !active ? "font-semibold text-red-600" : "opacity-75"}`}>{count}</span> : null}
            </button>
          );
        })}
        <select aria-label="Queue" className="ml-auto rounded-md border bg-background px-3 py-1.5 text-sm" value={queue} onChange={(event) => setQueue(event.target.value)}>
          {QUEUES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Card className="p-0 overflow-hidden">
        {rows === undefined ? (
          <div className="p-5">
            <Skeleton className="h-48 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{view === "resolved" ? "No closed cases yet." : "No cases here."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Case</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">{view === "resolved" ? "Decision" : "Due"}</th>
                  <th className="p-3">{view === "resolved" ? "Decided by" : "Assigned to"}</th>
                  <th className="p-3">Opened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="p-3">
                      <Link href={`/reviews/${row._id}`} className="font-medium text-foreground hover:underline">
                        {row.verification?.subject ?? "Case"}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.verification?.reference ?? ""} · {row.queueLabel}
                      </p>
                      {row.recommendation && row.status !== "resolved" ? (
                        <p className="text-xs text-amber-700">
                          {row.recommendation.byName} recommends {row.recommendation.action}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <CategoryBadge category={row.category} label={row.categoryLabel} />
                    </td>
                    <td className="p-3">
                      <PriorityBadge priority={row.priority} escalated={Boolean(row.escalatedAt)} />
                    </td>
                    <td className="p-3">
                      {row.resolution ? (
                        <span className={row.resolution.verdict === "pass" ? "text-emerald-700" : "text-red-700"}>
                          {row.resolution.verdict === "pass" ? "Approved" : row.resolution.verdict === "reject" ? "Rejected" : "Closed"}
                        </span>
                      ) : (
                        <DueLabel dueAt={row.dueAt} overdue={row.overdue} />
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.resolution ? `${row.resolution.byName ?? "—"}${row.resolution.source === "deeptrack" ? " (DeepTrack)" : ""}` : row.assignee?.name ?? <span className="italic">Unassigned</span>}
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      <ClientDate value={row.createdAt} format="PP" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
