"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { cn } from "@/backend/lib/utils";
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
import {
  REVIEW_PRIORITY,
  REVIEW_TRIGGER_LABELS,
  type ReviewPriority,
  type ReviewStatus,
  type ReviewTrigger,
  type Verdict,
  type VerificationStatus,
  formatAge,
  typeLabel,
  verdictBadge,
} from "@/components/sentinel/format";

export type ReviewQueueItem = {
  _id: string;
  verificationId: string;
  clientId: string;
  triggerType: ReviewTrigger;
  triggerReason: string;
  priority: ReviewPriority;
  status: ReviewStatus;
  escalated?: boolean;
  resolutionAction?: "confirm" | "keep_verdict" | "escalate";
  resolutionNotes?: string;
  resolvedBy?: string;
  createdAt: number;
  resolvedAt?: number;
  clientName: string | null;
  verification: {
    type: string;
    reference: string;
    status: VerificationStatus;
    verdict: Verdict;
    confidence: number | null;
  } | null;
};

// Mirrors the server-side order in backend/convex/reviewQueue.ts.
const TRIGGER_WEIGHT: Record<ReviewTrigger, number> = { client_dispute: 0, auto_escalation: 1, internal_flag: 2 };

export function reviewStatusBadge(item: Pick<ReviewQueueItem, "status" | "escalated">) {
  if (item.status === "resolved") return { tone: "green" as const, label: "resolved" };
  if (item.status === "in_review") return { tone: "blue" as const, label: item.escalated ? "escalated" : "in review" };
  return { tone: "amber" as const, label: "pending" };
}

export const RESOLUTION_LABELS = {
  confirm: "Confirmed (pass)",
  keep_verdict: "Kept verdict (reject)",
  escalate: "Escalated",
} as const;

type View = "open" | "resolved";

export function ReviewQueue({ canResolve }: { canResolve: boolean }) {
  const bounds = useTimeBoundaries();
  const [view, setView] = useState<View>("open");
  const pending = useAuthedQuery(anyApi.reviewQueue.listForInternalOps, { status: "pending" }) as
    | ReviewQueueItem[]
    | undefined;
  const inReview = useAuthedQuery(anyApi.reviewQueue.listForInternalOps, { status: "in_review" }) as
    | ReviewQueueItem[]
    | undefined;
  const resolved = useAuthedQuery(
    anyApi.reviewQueue.listForInternalOps,
    view === "resolved" ? { status: "resolved" } : "skip",
  ) as ReviewQueueItem[] | undefined;

  const open = useMemo(() => {
    if (!pending || !inReview) return undefined;
    return [...pending, ...inReview].sort(
      (a, b) => TRIGGER_WEIGHT[a.triggerType] - TRIGGER_WEIGHT[b.triggerType] || a.createdAt - b.createdAt,
    );
  }, [pending, inReview]);

  const rows = view === "open" ? open : resolved?.slice().sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const highPriority = open?.filter((item) => item.priority === "high").length;
  const oldest = open && open.length > 0 ? Math.min(...open.map((item) => item.createdAt)) : null;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Review queue</h1>
        <span className="text-[11px] text-sentinel-subtle">
          {open ? `${open.length} open` : "Loading…"}
          {canResolve ? "" : " · read only"}
        </span>
        <div className="ml-auto flex rounded-md border border-sentinel-line p-0.5" role="tablist" aria-label="Queue view">
          {(["open", "resolved"] as View[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] capitalize transition-colors",
                view === option ? "bg-sentinel-raised text-sentinel-text" : "text-sentinel-subtle hover:text-sentinel-text",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </TopBar>

      <div className="flex flex-col gap-3.5 px-5 py-4">
        <div className="flex flex-wrap gap-2.5">
          <StatTile label="Pending" value={pending?.length ?? "—"} tone={pending?.length ? "amber" : undefined} />
          <StatTile label="Escalated / in review" value={inReview?.length ?? "—"} tone={inReview?.length ? "blue" : undefined} />
          <StatTile label="High priority" value={highPriority ?? "—"} tone={highPriority ? "red" : undefined} />
          <StatTile
            label="Oldest open item"
            value={oldest !== null && bounds ? formatAge(bounds.now - oldest) : "—"}
            note={oldest !== null ? <ClientDate value={oldest} format="MMM d, HH:mm" /> : undefined}
          />
        </div>

        <Panel>
          <PanelHeader
            icon={ClipboardCheck}
            iconClassName="text-sentinel-blue-mid"
            title={view === "open" ? "Open items" : "Resolved items"}
            hint={view === "open" ? "client disputes first, then auto-escalations, oldest first" : "most recently resolved first"}
          />
          {rows === undefined ? (
            <div className="flex flex-col gap-2 p-3">
              {[0, 1, 2, 3].map((key) => (
                <SkeletonBlock key={key} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              head={
                view === "open"
                  ? ["Client", "Verification", "Trigger", "Priority", "Status", "Age", ""]
                  : ["Client", "Verification", "Trigger", "Outcome", "Resolved", ""]
              }
              empty={
                rows.length === 0 ? (
                  <EmptyState>{view === "open" ? "The review queue is empty." : "No resolved items yet."}</EmptyState>
                ) : null
              }
            >
              {rows.map((item) => {
                const priority = REVIEW_PRIORITY[item.priority];
                const status = reviewStatusBadge(item);
                const verdict = item.verification ? verdictBadge(item.verification.verdict, item.verification.status) : null;
                const href = `/internal-ops/review-queue/${item._id}`;
                return (
                  <Row key={item._id}>
                    <Cell>{item.clientName ?? <span className="text-sentinel-subtle">Unknown client</span>}</Cell>
                    <Cell>
                      {item.verification ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sentinel-muted">{typeLabel(item.verification.type)}</span>
                          <span className="font-mono text-[11px] text-sentinel-subtle">{item.verification.reference}</span>
                          {verdict ? <Badge tone={verdict.tone} icon={verdict.icon}>{verdict.label}</Badge> : null}
                        </div>
                      ) : (
                        <span className="text-sentinel-red-text">Verification missing</span>
                      )}
                    </Cell>
                    <Cell className="max-w-[340px] truncate text-sentinel-muted">
                      <span title={item.triggerReason}>
                        {REVIEW_TRIGGER_LABELS[item.triggerType]} — {item.triggerReason}
                      </span>
                    </Cell>
                    {view === "open" ? (
                      <>
                        <Cell>
                          <Badge tone={priority.tone}>{priority.label}</Badge>
                        </Cell>
                        <Cell>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </Cell>
                        <Cell className="text-sentinel-subtle">
                          <span title={new Date(item.createdAt).toISOString()}>
                            {bounds ? formatAge(bounds.now - item.createdAt) : "—"}
                          </span>
                        </Cell>
                      </>
                    ) : (
                      <>
                        <Cell className="text-sentinel-muted">
                          {item.resolutionAction ? RESOLUTION_LABELS[item.resolutionAction] : "—"}
                        </Cell>
                        <Cell className="text-sentinel-subtle">
                          <ClientDate value={item.resolvedAt} format="MMM d, HH:mm" />
                        </Cell>
                      </>
                    )}
                    <Cell>
                      <Link
                        href={href}
                        className="flex items-center gap-0.5 text-[11px] text-sentinel-blue-mid hover:text-sentinel-blue-light"
                      >
                        {view === "open" && canResolve ? "Review" : "View result"}
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </Cell>
                  </Row>
                );
              })}
            </DataTable>
          )}
        </Panel>
      </div>
    </SentinelCanvas>
  );
}
