"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { Search } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import {
  Badge,
  Breadcrumb,
  Cell,
  DataTable,
  EmptyState,
  Eyebrow,
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
  VERDICT_FILTERS,
  type ClientStatus,
  type Plan,
  type Verdict,
  type VerdictFilter,
  type VerificationStatus,
  formatDuration,
  formatNumber,
  formatPct,
  matchesVerdictFilter,
  typeLabel,
  verdictBadge,
} from "@/components/sentinel/format";

type PortalOverview = {
  client: { name: string; plan: Plan; status: ClientStatus; creditLimit: number; creditThresholdPct: number };
  credits: { balance: number; usedThisMonth: number };
  scans: { thisMonth: number; today: number };
  latency: { avgMs: number | null; p95Ms: number | null };
  flagged: { count: number; pct: number };
  apiKeys: { active: number; revoked: number };
  recent: Array<{
    reference: string;
    type: string;
    subject: string | null;
    status: VerificationStatus;
    verdict: Verdict;
    confidence: number | null;
    createdAt: number;
  }>;
  truncated: boolean;
};

const ACCOUNT_STATUS: Record<ClientStatus, { tone: "green" | "amber" | "red"; label: string }> = {
  active: { tone: "green", label: "Account active" },
  suspended: { tone: "red", label: "Account suspended" },
  trial_expired: { tone: "amber", label: "Trial expired" },
};

export function PortalView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const bounds = useTimeBoundaries();
  const data = useAuthedQuery(
    anyApi.portal.overview,
    bounds ? { clientId, monthStart: bounds.monthStart, dayStart: bounds.dayStart, recentLimit: 50 } : "skip",
  ) as PortalOverview | null | undefined;

  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.recent ?? []).filter(
      (row) =>
        matchesVerdictFilter(verdictFilter, row.verdict, row.status) &&
        (!needle ||
          row.reference.toLowerCase().includes(needle) ||
          (row.subject ?? "").toLowerCase().includes(needle)),
    );
  }, [data, search, verdictFilter]);

  const status = data ? ACCOUNT_STATUS[data.client.status] : null;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <label className="flex max-w-[320px] flex-1 items-center gap-2 rounded-md border border-sentinel-line bg-sentinel-surface px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-sentinel-subtle" aria-hidden="true" />
          <span className="sr-only">Search verifications</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your scans by ID or subject…"
            className="w-full bg-transparent text-[12px] text-sentinel-text placeholder:text-sentinel-subtle focus:outline-none"
          />
        </label>
        <div className="ml-auto flex items-center gap-3">
          {status ? <StatusDot tone={status.tone}>{status.label}</StatusDot> : null}
          <span className="hidden rounded-md border border-sentinel-line px-2.5 py-1.5 text-[11px] text-sentinel-muted sm:inline">
            {data ? `${clientName} · ${PLAN_LABELS[data.client.plan]} plan` : clientName}
          </span>
        </div>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        <Breadcrumb items={["Sentinel", "Client portal"]} />

        {data === undefined ? (
          <PortalSkeleton />
        ) : data === null ? (
          <Panel>
            <EmptyState>This organization could not be found.</EmptyState>
          </Panel>
        ) : (
          <>
            <CreditsCard data={data} />

            <div className="flex flex-wrap gap-2.5">
              <StatTile
                label="Scans this month"
                value={formatNumber(data.scans.thisMonth)}
                note={`+${formatNumber(data.scans.today)} today`}
              />
              <StatTile
                label="Avg. verification"
                value={formatDuration(data.latency.avgMs)}
                note={`p95: ${formatDuration(data.latency.p95Ms)}`}
              />
              <StatTile
                label="Flagged / review"
                value={formatNumber(data.flagged.count)}
                note={`${data.flagged.pct}% of this month`}
                tone={data.flagged.count > 0 ? "amber" : undefined}
              />
              <StatTile
                label="Active API keys"
                value={formatNumber(data.apiKeys.active)}
                note={
                  <Link href="/api-keys" className="hover:text-sentinel-blue-mid">
                    {data.apiKeys.revoked} revoked · manage
                  </Link>
                }
              />
            </div>

            <Panel>
              <PanelHeader
                title="Recent verifications"
                hint="all types"
                action={
                  <div className="flex gap-1.5">
                    <label className="sr-only" htmlFor="portal-verdict-filter">
                      Filter by verdict
                    </label>
                    <select
                      id="portal-verdict-filter"
                      value={verdictFilter}
                      onChange={(event) => setVerdictFilter(event.target.value as VerdictFilter)}
                      className="rounded border border-sentinel-line bg-sentinel-bg px-2 py-1 text-[11px] text-sentinel-muted focus:border-sentinel-blue focus:outline-none"
                    >
                      {VERDICT_FILTERS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
              <DataTable
                head={["Scan ID", "Type", "Subject", "Verdict", "Confidence", "Submitted"]}
                empty={
                  rows.length === 0 ? (
                    <EmptyState>
                      {data.recent.length === 0
                        ? "No verifications yet. Start one from the sidebar or the API."
                        : "No verifications match your search."}
                    </EmptyState>
                  ) : null
                }
              >
                {rows.map((row) => {
                  const badge = verdictBadge(row.verdict, row.status);
                  return (
                    <Row key={row.reference}>
                      <Cell className="font-mono text-[11px] text-sentinel-subtle">{row.reference}</Cell>
                      <Cell>
                        <Badge tone="outline">{typeLabel(row.type)}</Badge>
                      </Cell>
                      <Cell className="max-w-[220px] truncate text-sentinel-muted">{row.subject ?? "—"}</Cell>
                      <Cell>
                        <Badge tone={badge.tone} icon={badge.icon}>
                          {badge.label}
                        </Badge>
                      </Cell>
                      <Cell className="text-sentinel-muted">{formatPct(row.confidence)}</Cell>
                      <Cell className="text-sentinel-subtle">
                        <ClientDate value={row.createdAt} format="MMM d, HH:mm" />
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>
            {data.truncated ? (
              <p className="text-[11px] text-sentinel-subtle">
                Monthly figures cover the most recent 5,000 verifications.
              </p>
            ) : null}
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}

function CreditsCard({ data }: { data: PortalOverview }) {
  const { creditLimit, creditThresholdPct } = data.client;
  const { balance, usedThisMonth } = data.credits;
  const pct = creditLimit > 0 ? Math.round((usedThisMonth / creditLimit) * 1000) / 10 : null;
  return (
    <Panel className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Credits used this month</Eyebrow>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none">{formatNumber(usedThisMonth)}</span>
            {creditLimit > 0 ? (
              <span className="text-[13px] text-sentinel-subtle">/ {formatNumber(creditLimit)}</span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-sentinel-subtle">Balance remaining</div>
          <div
            className={
              balance <= 0 ? "text-[15px] font-semibold text-sentinel-red-text" : "text-[15px] font-semibold text-sentinel-blue-mid"
            }
          >
            {formatNumber(balance)} credits
          </div>
        </div>
      </div>
      {pct !== null ? (
        <>
          <UsageBar
            pct={pct}
            thresholdPct={creditThresholdPct}
            label="Monthly credit usage"
            className="mt-3 h-1.5 w-full"
          />
          <div className="mt-1.5 text-[11px] text-sentinel-subtle">
            {pct}% of plan limit used · alert at {creditThresholdPct}%
          </div>
        </>
      ) : (
        <div className="mt-2 text-[11px] text-sentinel-subtle">No monthly plan limit set for this organization.</div>
      )}
      {balance <= 0 ? (
        <div className="mt-2 text-[11px] text-sentinel-red-text">
          New verifications are refused until credits are added.{" "}
          <Link href="/billing" className="underline">
            Billing & credits
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

function PortalSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-label="Loading">
      <SkeletonBlock className="h-[104px] w-full" />
      <div className="flex flex-wrap gap-2.5">
        {[0, 1, 2, 3].map((key) => (
          <SkeletonBlock key={key} className="h-[72px] min-w-[150px] flex-1" />
        ))}
      </div>
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}
