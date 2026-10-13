"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Clock, GitCompareArrows, PieChart, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Panel,
  PanelHeader,
  Row,
  SentinelCanvas,
  SkeletonBlock,
  StatTile,
  TopBar,
} from "@/components/sentinel/ui";
import { REVIEW_PRIORITY, formatAge, formatDuration, formatNumber, typeLabel } from "@/components/sentinel/format";

type Priority = "high" | "normal" | "low";

type Data = {
  viewerId: string;
  viewerIsAdmin: boolean;
  deadlineHours: Record<Priority, number>;
  openCount: number;
  unassignedCount: number;
  overdueCount: number;
  byPriority: Array<{ priority: Priority; deadlineHours: number; resolved: number; withinDeadline: number; medianMs: number | null; openOverdue: number }>;
  reviewers: Array<{ id: string; name: string; open: number; overdue: number; resolved30: number; medianResolveMs: number | null }>;
  holdReasons: Array<{ reason: string; open: number; last30: number }>;
  overturns: Array<{ type: string; decided: number; overturned: number; falseReject: number; falseAccept: number }>;
  openItems: Array<{
    _id: string;
    clientName: string;
    type: string | null;
    reference: string | null;
    priority: Priority;
    reason: string;
    createdAt: number;
    overdue: boolean;
    dueAt: number;
    assignedTo: string | null;
    assignedToName: string | null;
  }>;
  truncated: boolean;
};

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";
}

export function ReviewOperations() {
  const bounds = useTimeBoundaries();
  const data = useAuthedQuery(anyApi.backOfficeReviews.reviewOperations, bounds ? { now: bounds.now } : "skip") as Data | undefined;
  const assign = useMutation(anyApi.backOfficeReviews.assignReviewItem);
  const [busy, setBusy] = useState<string | null>(null);

  async function setAssignee(reviewId: string, to: "me" | "nobody" | { userId: string; name?: string }) {
    setBusy(reviewId);
    try {
      await assign({ reviewId, to });
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not change the assignment."));
    } finally {
      setBusy(null);
    }
  }

  const resolved30 = data?.byPriority.reduce((sum, row) => sum + row.resolved, 0) ?? 0;
  const within = data?.byPriority.reduce((sum, row) => sum + row.withinDeadline, 0) ?? 0;
  const decided = data?.overturns.reduce((sum, row) => sum + row.decided, 0) ?? 0;
  const overturned = data?.overturns.reduce((sum, row) => sum + row.overturned, 0) ?? 0;
  const maxReason = Math.max(1, ...(data?.holdReasons.map((row) => row.last30) ?? [1]));

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Review operations</h1>
        <span className="text-[11px] text-sentinel-subtle">
          Workload · deadlines · overturns · why items are held
          {data ? ` · deadlines: high ${data.deadlineHours.high}h, normal ${data.deadlineHours.normal}h, low ${data.deadlineHours.low}h` : ""}
        </span>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined || !bounds ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-64" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5">
              <StatTile label="Open items" value={formatNumber(data.openCount)} note={`${formatNumber(data.unassignedCount)} unassigned`} />
              <StatTile
                label="Past deadline"
                value={formatNumber(data.overdueCount)}
                note="open items"
                tone={data.overdueCount > 0 ? "red" : undefined}
              />
              <StatTile label="Resolved on time" value={pct(within, resolved30)} note={`of ${formatNumber(resolved30)} resolved in 30 days`} />
              <StatTile
                label="Overturn rate"
                value={pct(overturned, decided)}
                note={`reviewer corrected the automation, ${formatNumber(decided)} decisions in 90 days`}
                tone={decided > 0 && overturned / decided > 0.2 ? "amber" : undefined}
              />
            </div>

            <Panel>
              <PanelHeader icon={UserCheck} title="Open items" hint="past-deadline items first" action={<Link href="/internal-ops/review-queue" className="text-[11px] text-sentinel-blue-mid">Review queue</Link>} />
              <DataTable
                head={["Client", "Verification", "Priority", "Held because", "Age", "Due", "Assigned to", ""]}
                empty={data.openItems.length === 0 ? <EmptyState>Nothing open.</EmptyState> : null}
              >
                {data.openItems.map((item) => {
                  const priority = REVIEW_PRIORITY[item.priority];
                  const mine = item.assignedTo === data.viewerId;
                  return (
                    <Row key={item._id}>
                      <Cell>{item.clientName}</Cell>
                      <Cell>
                        <Link href={`/internal-ops/review-queue/${item._id}`} className="hover:text-sentinel-blue-mid">
                          {typeLabel(item.type)}
                          <span className="block font-mono text-[10px] text-sentinel-subtle">{item.reference ?? "—"}</span>
                        </Link>
                      </Cell>
                      <Cell>
                        <Badge tone={priority.tone}>{priority.label}</Badge>
                      </Cell>
                      <Cell className="text-sentinel-muted">{item.reason}</Cell>
                      <Cell className="text-sentinel-muted">{formatAge(bounds.now - item.createdAt)}</Cell>
                      <Cell>
                        {item.overdue ? (
                          <Badge tone="red">{formatAge(bounds.now - item.dueAt)} late</Badge>
                        ) : (
                          <span className="text-sentinel-muted">in {formatAge(item.dueAt - bounds.now)}</span>
                        )}
                      </Cell>
                      <Cell className="text-sentinel-muted">{item.assignedToName ?? <span className="text-sentinel-faint">unassigned</span>}</Cell>
                      <Cell>
                        <div className="flex gap-2 text-[11px]">
                          {!mine && (!item.assignedTo || data.viewerIsAdmin) ? (
                            <button type="button" disabled={busy === item._id} onClick={() => setAssignee(item._id, "me")} className="text-sentinel-blue-mid disabled:opacity-50">
                              {item.assignedTo ? "Take over" : "Assign to me"}
                            </button>
                          ) : null}
                          {item.assignedTo && (mine || data.viewerIsAdmin) ? (
                            <button type="button" disabled={busy === item._id} onClick={() => setAssignee(item._id, "nobody")} className="text-sentinel-muted disabled:opacity-50">
                              Unassign
                            </button>
                          ) : null}
                          {data.viewerIsAdmin && data.reviewers.length > 0 ? (
                            <select
                              aria-label="Assign to reviewer"
                              className="rounded border border-sentinel-line bg-sentinel-raised px-1 py-0.5 text-[11px] text-sentinel-text"
                              value=""
                              disabled={busy === item._id}
                              onChange={(event) => {
                                const reviewer = data.reviewers.find((row) => row.id === event.target.value);
                                if (reviewer) void setAssignee(item._id, { userId: reviewer.id, name: reviewer.name !== reviewer.id ? reviewer.name : undefined });
                              }}
                            >
                              <option value="">Assign…</option>
                              {data.reviewers.map((reviewer) => (
                                <option key={reviewer.id} value={reviewer.id}>
                                  {reviewer.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={Users} title="Reviewer workload" hint="open now · resolved in 30 days" />
                <DataTable
                  head={["Reviewer", "Open", "Past deadline", "Resolved (30 d)", "Median time"]}
                  empty={data.reviewers.length === 0 ? <EmptyState>No assignments or resolutions yet.</EmptyState> : null}
                >
                  {data.reviewers.map((reviewer) => (
                    <Row key={reviewer.id}>
                      <Cell>{reviewer.id === data.viewerId ? `${reviewer.name} (you)` : reviewer.name}</Cell>
                      <Cell>{formatNumber(reviewer.open)}</Cell>
                      <Cell className={reviewer.overdue > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>{formatNumber(reviewer.overdue)}</Cell>
                      <Cell>{formatNumber(reviewer.resolved30)}</Cell>
                      <Cell className="text-sentinel-muted">{formatDuration(reviewer.medianResolveMs)}</Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={Clock} title="Turnaround by priority" hint="resolved in the last 30 days" />
                <DataTable head={["Priority", "Deadline", "Resolved", "On time", "Median time", "Open, past deadline"]}>
                  {data.byPriority.map((row) => {
                    const priority = REVIEW_PRIORITY[row.priority];
                    return (
                      <Row key={row.priority}>
                        <Cell>
                          <Badge tone={priority.tone}>{priority.label}</Badge>
                        </Cell>
                        <Cell className="text-sentinel-muted">{row.deadlineHours} h</Cell>
                        <Cell>{formatNumber(row.resolved)}</Cell>
                        <Cell className="text-sentinel-muted">{pct(row.withinDeadline, row.resolved)}</Cell>
                        <Cell className="text-sentinel-muted">{formatDuration(row.medianMs)}</Cell>
                        <Cell className={row.openOverdue > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>{formatNumber(row.openOverdue)}</Cell>
                      </Row>
                    );
                  })}
                </DataTable>
              </Panel>
            </div>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={PieChart} title="Why items are held" hint="opened in the last 30 days · open now" />
                {data.holdReasons.length === 0 ? (
                  <EmptyState>No review items in the last 30 days.</EmptyState>
                ) : (
                  <div className="space-y-2 px-3.5 py-3">
                    {data.holdReasons.map((row) => (
                      <div key={row.reason} className="text-[12px]">
                        <div className="flex justify-between">
                          <span>{row.reason}</span>
                          <span className="text-sentinel-muted">
                            {formatNumber(row.last30)} · {formatNumber(row.open)} open
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-sentinel-line-soft">
                          <div
                            className={row.reason === "Service outage" ? "h-full rounded bg-sentinel-red" : "h-full rounded bg-sentinel-blue"}
                            style={{ width: `${(row.last30 / maxReason) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel>
                <PanelHeader icon={GitCompareArrows} title="Overturn rate by type" hint="last 90 days · a rising rate means the automation is drifting" />
                <DataTable
                  head={["Type", "Decisions", "Overturned", "Rate", "Wrongly held / flagged", "Wrongly passed"]}
                  empty={data.overturns.length === 0 ? <EmptyState>No reviewer decisions in the last 90 days.</EmptyState> : null}
                >
                  {data.overturns.map((row) => (
                    <Row key={row.type}>
                      <Cell>{typeLabel(row.type)}</Cell>
                      <Cell>{formatNumber(row.decided)}</Cell>
                      <Cell>{formatNumber(row.overturned)}</Cell>
                      <Cell className={row.decided > 0 && row.overturned / row.decided > 0.2 ? "text-sentinel-amber" : "text-sentinel-muted"}>
                        {pct(row.overturned, row.decided)}
                      </Cell>
                      <Cell className="text-sentinel-muted">{formatNumber(row.falseReject)}</Cell>
                      <Cell className="text-sentinel-muted">{formatNumber(row.falseAccept)}</Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>
            </div>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}
