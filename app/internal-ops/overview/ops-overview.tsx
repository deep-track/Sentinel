"use client";

import Link from "next/link";
import { anyApi } from "convex/server";
import { Activity, Bell, Building2, ChevronRight, FileWarning } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
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
  StatusDot,
  TopBar,
  UsageBar,
} from "@/components/sentinel/ui";
import {
  PLAN_LABELS,
  type ClientStatus,
  type Plan,
  type Verdict,
  type VerificationStatus,
  clientStatusBadge,
  formatDuration,
  formatNumber,
  formatPct,
  typeLabel,
  verdictBadge,
} from "@/components/sentinel/format";

export type ClientSummary = {
  _id: string;
  name: string;
  plan: Plan;
  status: ClientStatus;
  creditLimit: number;
  creditThresholdPct: number;
  rpmCap: number;
  balance: number;
  usedThisMonth: number;
  usagePct: number | null;
  createdAt: number;
};

type OpsOverview = {
  stats: {
    activeClients: number;
    suspendedClients: number;
    trialExpiredClients: number;
    scansToday: number;
    scansYesterday: number;
    creditsToday: number;
    openReviews: number;
    clientDisputes: number;
    latency: { avgMs: number | null; p95Ms: number | null };
  };
  clients: ClientSummary[];
  alerts: Array<{ severity: "critical" | "warning"; title: string; detail?: string; at?: number }>;
  recent: Array<{
    reference: string;
    clientName: string;
    type: string;
    status: VerificationStatus;
    verdict: Verdict;
    confidence: number | null;
    latencyMs: number | null;
    createdAt: number;
  }>;
  queue: Array<{
    _id: string;
    clientName: string;
    type: string | null;
    reference: string | null;
    triggerType: "client_dispute" | "auto_escalation" | "internal_flag";
    triggerReason: string;
    priority: "high" | "normal" | "low";
    status: "pending" | "in_review";
    createdAt: number;
  }>;
  truncated: boolean;
};

const PRIORITY = {
  high: { tone: "red", label: "P1" },
  normal: { tone: "amber", label: "P2" },
  low: { tone: "neutral", label: "P3" },
} as const;

const TRIGGER_LABELS = {
  client_dispute: "Client dispute",
  auto_escalation: "Auto-escalation",
  internal_flag: "Internal flag",
} as const;

function dayOverDay(today: number, yesterday: number) {
  if (yesterday === 0) return "none yesterday";
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs yesterday`;
}

function ViewAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-0.5 text-[11px] text-sentinel-blue-mid hover:text-sentinel-blue-light">
      {children}
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

export function OpsOverview() {
  const bounds = useTimeBoundaries();
  const data = useAuthedQuery(anyApi.admin.opsOverview, bounds ? { ...bounds, recentLimit: 10 } : "skip") as
    | OpsOverview
    | undefined;

  const critical = data?.alerts.filter((alert) => alert.severity === "critical").length ?? 0;
  const totalClients = data?.clients.length ?? 0;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Overview</h1>
        <span className="text-[11px] text-sentinel-subtle">Cross-client · live</span>
        <div className="ml-auto">
          {data ? (
            critical > 0 ? (
              <StatusDot tone="red">
                {totalClients} clients · {critical} critical alert{critical === 1 ? "" : "s"}
              </StatusDot>
            ) : data.alerts.length > 0 ? (
              <StatusDot tone="amber">
                {totalClients} clients · {data.alerts.length} open alert{data.alerts.length === 1 ? "" : "s"}
              </StatusDot>
            ) : (
              <StatusDot tone="green">{totalClients} clients · all checks nominal</StatusDot>
            )
          ) : null}
        </div>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined ? (
          <OpsSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5">
              <StatTile
                label="Active clients"
                value={formatNumber(data.stats.activeClients)}
                note={[
                  data.stats.suspendedClients ? `${data.stats.suspendedClients} suspended` : null,
                  data.stats.trialExpiredClients ? `${data.stats.trialExpiredClients} trial expired` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "none suspended"}
              />
              <StatTile
                label="Scans today"
                value={formatNumber(data.stats.scansToday)}
                note={dayOverDay(data.stats.scansToday, data.stats.scansYesterday)}
              />
              <StatTile label="Credits consumed" value={formatNumber(data.stats.creditsToday)} note="today, all plans" />
              <StatTile
                label="In review queue"
                value={formatNumber(data.stats.openReviews)}
                note={`${data.stats.clientDisputes} client dispute${data.stats.clientDisputes === 1 ? "" : "s"}`}
                tone={data.stats.openReviews > 0 ? "amber" : undefined}
              />
              <StatTile
                label="Open alerts"
                value={formatNumber(data.alerts.length)}
                note={`${critical} critical`}
                tone={critical > 0 ? "red" : undefined}
              />
            </div>

            <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
              <Panel>
                <PanelHeader
                  icon={Building2}
                  title="Client accounts"
                  action={<ViewAll href="/internal-ops/clients">Manage all</ViewAll>}
                />
                <DataTable
                  head={["Client", "Plan", "Credits this month", "Balance", "Status"]}
                  empty={data.clients.length === 0 ? <EmptyState>No client accounts yet.</EmptyState> : null}
                >
                  {data.clients.slice(0, 8).map((client) => {
                    const status = clientStatusBadge(client.status);
                    return (
                      <Row key={client._id}>
                        <Cell>
                          <Link href={`/internal-ops/clients?client=${client._id}`} className="hover:text-sentinel-blue-mid">
                            {client.name}
                          </Link>
                        </Cell>
                        <Cell className="text-sentinel-muted">{PLAN_LABELS[client.plan]}</Cell>
                        <Cell>
                          <div className="flex items-center gap-2">
                            <UsageBar
                              pct={client.usagePct}
                              thresholdPct={client.creditThresholdPct}
                              label={`${client.name} monthly credit usage`}
                            />
                            <span className="text-[11px] text-sentinel-subtle">
                              {client.usagePct === null ? "no limit" : `${client.usagePct}%`}
                            </span>
                          </div>
                        </Cell>
                        <Cell className={client.balance <= 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>
                          {formatNumber(client.balance)}
                        </Cell>
                        <Cell>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </Cell>
                      </Row>
                    );
                  })}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={Bell} iconClassName="text-sentinel-amber" title="System alerts" />
                {data.alerts.length === 0 ? (
                  <EmptyState>No open alerts.</EmptyState>
                ) : (
                  <ul className="flex flex-col">
                    {data.alerts.slice(0, 8).map((alert) => (
                      <li
                        key={`${alert.severity}-${alert.title}`}
                        className="flex gap-2 border-b border-sentinel-line-soft px-3.5 py-2.5 last:border-b-0"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            alert.severity === "critical" ? "bg-sentinel-red" : "bg-sentinel-amber"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="text-[12px]">
                            <span className="sr-only">{alert.severity}: </span>
                            {alert.title}
                          </div>
                          {alert.detail || alert.at ? (
                            <div className="text-[10px] text-sentinel-subtle">
                              {alert.detail}
                              {alert.at ? (
                                <>
                                  {" "}
                                  Last fetched <ClientDate value={alert.at} format="relative" />.
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel>
              <PanelHeader
                icon={Activity}
                title="Global verification log"
                hint="IDP · KYB · KYI · AML · Liveness — all clients"
              />
              <DataTable
                head={["Client", "Scan ID", "Type", "Verdict", "Confidence", "Latency", "Submitted"]}
                empty={data.recent.length === 0 ? <EmptyState>No verifications yet.</EmptyState> : null}
              >
                {data.recent.map((row) => {
                  const badge = verdictBadge(row.verdict, row.status);
                  return (
                    <Row key={row.reference}>
                      <Cell>{row.clientName}</Cell>
                      <Cell className="font-mono text-[11px] text-sentinel-subtle">{row.reference}</Cell>
                      <Cell className="text-sentinel-muted">{typeLabel(row.type)}</Cell>
                      <Cell>
                        <Badge tone={badge.tone} icon={badge.icon}>
                          {badge.label}
                        </Badge>
                      </Cell>
                      <Cell className="text-sentinel-muted">{formatPct(row.confidence)}</Cell>
                      <Cell className="text-sentinel-subtle">{formatDuration(row.latencyMs)}</Cell>
                      <Cell className="text-sentinel-subtle">
                        <ClientDate value={row.createdAt} format="MMM d, HH:mm" />
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>

            <Panel>
              <PanelHeader
                icon={FileWarning}
                iconClassName="text-sentinel-blue-mid"
                title="Review queue"
                hint="open items, highest priority first"
                action={<ViewAll href="/internal-ops/monitoring">Screening monitor</ViewAll>}
              />
              <DataTable
                head={["Client", "Type", "Trigger", "Priority", "Status", "Opened"]}
                empty={data.queue.length === 0 ? <EmptyState>The review queue is empty.</EmptyState> : null}
              >
                {data.queue.map((item) => {
                  const priority = PRIORITY[item.priority];
                  return (
                    <Row key={item._id}>
                      <Cell>{item.clientName}</Cell>
                      <Cell className="text-sentinel-muted">{typeLabel(item.type)}</Cell>
                      <Cell className="max-w-[340px] truncate text-sentinel-muted">
                        <span title={item.triggerReason}>
                          {TRIGGER_LABELS[item.triggerType]} — {item.triggerReason}
                        </span>
                      </Cell>
                      <Cell>
                        <Badge tone={priority.tone}>{priority.label}</Badge>
                      </Cell>
                      <Cell className="text-sentinel-muted">{item.status === "in_review" ? "in review" : "pending"}</Cell>
                      <Cell className="text-sentinel-subtle">
                        <ClientDate value={item.createdAt} format="relative" />
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>

            <p className="text-[11px] text-sentinel-subtle">
              Today&apos;s avg. verification time {formatDuration(data.stats.latency.avgMs)} · p95{" "}
              {formatDuration(data.stats.latency.p95Ms)}
              {data.truncated ? " · figures cover the most recent 10,000 verifications" : ""}
            </p>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}

function OpsSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-wrap gap-2.5">
        {[0, 1, 2, 3, 4].map((key) => (
          <SkeletonBlock key={key} className="h-[72px] min-w-[140px] flex-1" />
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
