"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Activity, KeyRound, ListChecks, MessageSquare, RefreshCw, Send, Timer, Webhook } from "lucide-react";
import { toast } from "sonner";
import { ClientDate } from "@/components/client-date";
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
  StatusDot,
  TopBar,
} from "@/components/sentinel/ui";
import { formatAge, formatDuration, formatNumber, typeLabel } from "@/components/sentinel/format";

type Probe = {
  service: string;
  label: string;
  latest: { ok: boolean; httpStatus: number | null; latencyMs: number | null; error: string | null; checkedAt: number } | null;
  availability24h: number | null;
  checks24h: number;
  lastOkAt: number | null;
};

type Health = {
  probes: Probe[];
  config: Array<{ key: string; label: string; purpose: string; required: boolean; set: boolean }>;
  watchlists: Array<{
    sourceKey: string;
    label: string;
    recordCount: number;
    fetchedAt: number | null;
    stale: boolean;
    missing: boolean;
    lastSuccessfulAt: number | null;
    lastError: string | null;
  }>;
  traffic: {
    total: number;
    truncated: boolean;
    stepFailures: Array<{ step: string; service: string; failures: number }>;
    aml: { screened: number; openSanctionsGaps: number; watchlistGaps: number };
    outageHolds: number;
    byType: Array<{ type: string; total: number; failed: number; review: number; p50Ms: number | null; p95Ms: number | null }>;
    byClient: Array<{ clientId: string; name: string; total: number; p50Ms: number | null; p95Ms: number | null }>;
  };
  invitations: { total: number; delivered: number; sent: number; failed: number; failureReasons: Array<{ reason: string; count: number }> };
  webhooks: {
    total: number;
    delivered: number;
    retrying: number;
    failed: number;
    failedDeliveries: Array<{
      _id: string;
      clientName: string;
      reference: string | null;
      attemptCount: number;
      lastResponseStatus: number | null;
      lastAttemptAt: number | null;
    }>;
  };
};

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";
}

export function ServiceHealth({ canWrite }: { canWrite: boolean }) {
  const bounds = useTimeBoundaries();
  const data = useAuthedQuery(anyApi.backOfficeHealth.serviceHealth, bounds ? { now: bounds.now } : "skip") as Health | undefined;
  const runChecksNow = useMutation(anyApi.backOfficeHealth.runChecksNow);
  const retryWebhook = useMutation(anyApi.backOfficeHealth.retryWebhookDelivery);
  const [running, setRunning] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  const down = data?.probes.filter((probe) => !probe.latest?.ok).length ?? 0;
  const missingRequired = data?.config.filter((item) => item.required && !item.set).length ?? 0;

  async function runNow() {
    setRunning(true);
    try {
      await runChecksNow({});
      toast.success("Checks started. Results appear here within a few seconds.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not start the checks."));
    } finally {
      setRunning(false);
    }
  }

  async function resend(deliveryId: string) {
    setResending(deliveryId);
    try {
      await retryWebhook({ deliveryId });
      toast.success("Webhook resent.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not resend the webhook."));
    } finally {
      setResending(null);
    }
  }

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Service health</h1>
        <span className="text-[11px] text-sentinel-subtle">Dependencies · configuration · last 7 days</span>
        <div className="ml-auto flex items-center gap-3">
          {data ? (
            down > 0 || missingRequired > 0 ? (
              <StatusDot tone="red">
                {down} of {data.probes.length} services down · {missingRequired} required setting{missingRequired === 1 ? "" : "s"} missing
              </StatusDot>
            ) : (
              <StatusDot tone="green">All services up · configuration complete</StatusDot>
            )
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={runNow}
              disabled={running}
              className="flex items-center gap-1 rounded border border-sentinel-chip px-2 py-1 text-[11px] text-sentinel-muted hover:text-sentinel-text disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" /> Run checks now
            </button>
          ) : null}
        </div>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined || !bounds ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-48" />
          </div>
        ) : (
          <>
            <Panel>
              <PanelHeader icon={Activity} title="External services" hint="probed every 15 minutes" />
              <DataTable
                head={["Service", "Status", "Last check", "Up (24 h)", "Response", "Detail"]}
                empty={data.probes.every((probe) => !probe.latest) ? <EmptyState>No checks have run yet. They start within 15 minutes of deploying.</EmptyState> : null}
              >
                {data.probes.map((probe) => (
                  <Row key={probe.service}>
                    <Cell>{probe.label}</Cell>
                    <Cell>
                      {probe.latest ? (
                        <Badge tone={probe.latest.ok ? "green" : "red"}>{probe.latest.ok ? "Up" : "Down"}</Badge>
                      ) : (
                        <Badge tone="neutral">Not checked</Badge>
                      )}
                    </Cell>
                    <Cell className="text-sentinel-muted">
                      {probe.latest ? `${formatAge(bounds.now - probe.latest.checkedAt)} ago` : "—"}
                    </Cell>
                    <Cell className="text-sentinel-muted">
                      {probe.availability24h === null ? "—" : `${probe.availability24h}% of ${probe.checks24h}`}
                    </Cell>
                    <Cell className="text-sentinel-muted">{formatDuration(probe.latest?.latencyMs ?? null)}</Cell>
                    <Cell className="text-sentinel-muted">
                      {probe.latest?.error ?? (probe.latest?.ok ? `HTTP ${probe.latest.httpStatus ?? "—"}` : "—")}
                      {probe.latest && !probe.latest.ok && probe.lastOkAt ? (
                        <span className="block text-[10px] text-sentinel-subtle">
                          last up <ClientDate value={probe.lastOkAt} format="MMM d, HH:mm" />
                        </span>
                      ) : null}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={KeyRound} title="Configuration" hint="Convex settings · values never shown" />
                <DataTable head={["Setting", "Used for", "Status"]}>
                  {data.config.map((item) => (
                    <Row key={item.key}>
                      <Cell>
                        {item.label}
                        <span className="block font-mono text-[10px] text-sentinel-subtle">{item.key}</span>
                      </Cell>
                      <Cell className="text-sentinel-muted">{item.purpose}</Cell>
                      <Cell>
                        {item.set ? (
                          <Badge tone="green">Set</Badge>
                        ) : item.required ? (
                          <Badge tone="red">Missing</Badge>
                        ) : (
                          <Badge tone="neutral">Not set (optional)</Badge>
                        )}
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={ListChecks} title="Watchlists" />
                <DataTable head={["List", "Records", "Last refreshed", "Status"]}>
                  {data.watchlists.map((list) => (
                    <Row key={list.sourceKey}>
                      <Cell>{list.label}</Cell>
                      <Cell>{formatNumber(list.recordCount)}</Cell>
                      <Cell className="text-sentinel-muted">
                        {list.fetchedAt ? <ClientDate value={list.fetchedAt} format="MMM d, HH:mm" /> : "—"}
                      </Cell>
                      <Cell>
                        <Badge tone={list.missing ? "red" : list.stale ? "amber" : "green"}>
                          {list.missing ? "Unavailable" : list.stale ? "Stale" : "Current"}
                        </Badge>
                        {list.lastError ? <span className="mt-1 block text-[10px] text-sentinel-red-text">{list.lastError}</span> : null}
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <StatTile label="Verifications, 7 days" value={formatNumber(data.traffic.total)} note={data.traffic.truncated ? "newest 10,000 only" : "all types"} />
              <StatTile
                label="Held by outages"
                value={formatNumber(data.traffic.outageHolds)}
                note="review items caused by a service failure"
                tone={data.traffic.outageHolds > 0 ? "amber" : undefined}
              />
              <StatTile
                label="OpenSanctions gaps"
                value={formatNumber(data.traffic.aml.openSanctionsGaps)}
                note={`of ${formatNumber(data.traffic.aml.screened)} AML screenings (${pct(data.traffic.aml.openSanctionsGaps, data.traffic.aml.screened)})`}
                tone={data.traffic.aml.openSanctionsGaps > 0 ? "amber" : undefined}
              />
              <StatTile
                label="Watchlist gaps"
                value={formatNumber(data.traffic.aml.watchlistGaps)}
                note="AML screenings missing OFAC or UN"
                tone={data.traffic.aml.watchlistGaps > 0 ? "amber" : undefined}
              />
            </div>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={Activity} title="Failed scan steps" hint="last 7 days" />
                <DataTable
                  head={["Depends on", "Failures"]}
                  empty={data.traffic.stepFailures.length === 0 ? <EmptyState>No scan step failed in the last 7 days.</EmptyState> : null}
                >
                  {data.traffic.stepFailures.map((row) => (
                    <Row key={row.step}>
                      <Cell>{row.service}</Cell>
                      <Cell className="text-sentinel-red-text">{formatNumber(row.failures)}</Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={Timer} title="Speed and failures by type" hint="last 7 days" />
                <DataTable
                  head={["Type", "Volume", "Failed", "Held for review", "Median", "p95"]}
                  empty={data.traffic.byType.length === 0 ? <EmptyState>No verifications in the last 7 days.</EmptyState> : null}
                >
                  {data.traffic.byType.map((row) => (
                    <Row key={row.type}>
                      <Cell>{typeLabel(row.type)}</Cell>
                      <Cell>{formatNumber(row.total)}</Cell>
                      <Cell className={row.failed > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>{pct(row.failed, row.total)}</Cell>
                      <Cell className="text-sentinel-muted">{pct(row.review, row.total)}</Cell>
                      <Cell className="text-sentinel-muted">{formatDuration(row.p50Ms)}</Cell>
                      <Cell className="text-sentinel-muted">{formatDuration(row.p95Ms)}</Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>
            </div>

            <Panel>
              <PanelHeader icon={Timer} title="Slowest clients" hint="p95 completion time, last 7 days" />
              <DataTable
                head={["Client", "Verifications", "Median", "p95"]}
                empty={data.traffic.byClient.length === 0 ? <EmptyState>No client traffic in the last 7 days.</EmptyState> : null}
              >
                {data.traffic.byClient.map((row) => (
                  <Row key={row.clientId}>
                    <Cell>{row.name}</Cell>
                    <Cell>{formatNumber(row.total)}</Cell>
                    <Cell className="text-sentinel-muted">{formatDuration(row.p50Ms)}</Cell>
                    <Cell className="text-sentinel-muted">{formatDuration(row.p95Ms)}</Cell>
                  </Row>
                ))}
              </DataTable>
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader
                  icon={MessageSquare}
                  title="Liveness texts"
                  hint={`${formatNumber(data.invitations.total)} sent in 7 days · ${formatNumber(data.invitations.delivered)} delivered · ${formatNumber(data.invitations.failed)} failed`}
                />
                <DataTable
                  head={["Failure reason", "Count"]}
                  empty={data.invitations.failureReasons.length === 0 ? <EmptyState>No failed liveness texts in the last 7 days.</EmptyState> : null}
                >
                  {data.invitations.failureReasons.map((row) => (
                    <Row key={row.reason}>
                      <Cell>{row.reason}</Cell>
                      <Cell className="text-sentinel-red-text">{formatNumber(row.count)}</Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader
                  icon={Webhook}
                  title="Client webhooks"
                  hint={`${formatNumber(data.webhooks.total)} in 7 days · ${formatNumber(data.webhooks.delivered)} delivered · ${formatNumber(data.webhooks.retrying)} retrying · ${formatNumber(data.webhooks.failed)} failed`}
                />
                <DataTable
                  head={["Client", "Scan ID", "Attempts", "Last response", ""]}
                  empty={data.webhooks.failedDeliveries.length === 0 ? <EmptyState>No failed webhook deliveries in the last 7 days.</EmptyState> : null}
                >
                  {data.webhooks.failedDeliveries.map((row) => (
                    <Row key={row._id}>
                      <Cell>{row.clientName}</Cell>
                      <Cell className="font-mono text-[11px] text-sentinel-muted">{row.reference ?? "—"}</Cell>
                      <Cell className="text-sentinel-muted">{row.attemptCount}</Cell>
                      <Cell className="text-sentinel-muted">{row.lastResponseStatus ? `HTTP ${row.lastResponseStatus}` : "No response"}</Cell>
                      <Cell>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => resend(row._id)}
                            disabled={resending === row._id}
                            className="flex items-center gap-1 text-[11px] text-sentinel-blue-mid hover:text-sentinel-blue-light disabled:opacity-50"
                          >
                            <Send className="h-3 w-3" aria-hidden="true" /> Resend
                          </button>
                        ) : null}
                      </Cell>
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
