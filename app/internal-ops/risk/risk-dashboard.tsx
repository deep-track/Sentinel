"use client";

import { anyApi } from "convex/server";
import { Flag, Globe, ScanFace, ShieldAlert, Users } from "lucide-react";
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
  TopBar,
} from "@/components/sentinel/ui";
import { formatNumber, typeLabel, verdictBadge } from "@/components/sentinel/format";

type Count = { key: string; hits: number; critical: number; verifications: number };

type Risk = {
  weeks: number;
  truncated: boolean;
  sources: string[];
  weekly: Array<{ weekStart: number; bySource: Record<string, number>; total: number }>;
  totals: { hits: number; critical: number; flaggedVerifications: number; fakeFaces: number };
  bySource: Count[];
  byClient: Array<Count & { name: string }>;
  byCountry: Count[];
  byProgram: Count[];
  outcomes: Array<{ type: string; total: number; reject: number; review: number }>;
  fakeFaces: Array<{
    reference: string;
    clientName: string;
    type: string;
    source: "selfie" | "video";
    confidencePct: number | null;
    verdict: "pass" | "review" | "reject" | null;
    createdAt: number;
  }>;
};

const SOURCE_LABELS: Record<string, string> = {
  OFAC_SDN: "OFAC SDN",
  UN_CONSOLIDATED: "UN Consolidated",
  EU_FSF: "EU Consolidated",
  UK_SANCTIONS: "UK Sanctions List",
  OPENSANCTIONS: "OpenSanctions",
  FBI_MOST_WANTED: "FBI Most Wanted",
  ADVERSE_MEDIA: "Adverse media",
  KE_PEP: "Kenyan PEP register",
  KE_RISK_LIST: "Kenyan risk lists (Sentinel)",
};

// Fixed order and colours so a list keeps its colour across weeks.
const SOURCE_COLORS: Record<string, string> = {
  OFAC_SDN: "#0191DA",
  UN_CONSOLIDATED: "#7EC7EA",
  EU_FSF: "#2E7D5B",
  UK_SANCTIONS: "#5B6B8C",
  OPENSANCTIONS: "#E8A33D",
  FBI_MOST_WANTED: "#E5484D",
  ADVERSE_MEDIA: "#8E4EC6",
};

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";
}

function CountTable({ rows, label, empty }: { rows: Array<Count & { name?: string }>; label: string; empty: string }) {
  return (
    <DataTable head={[label, "Hits", "Critical", "Verifications"]} empty={rows.length === 0 ? <EmptyState>{empty}</EmptyState> : null}>
      {rows.map((row) => (
        <Row key={row.key}>
          <Cell>{row.name ?? SOURCE_LABELS[row.key] ?? row.key}</Cell>
          <Cell>{formatNumber(row.hits)}</Cell>
          <Cell className={row.critical > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>{formatNumber(row.critical)}</Cell>
          <Cell className="text-sentinel-muted">{formatNumber(row.verifications)}</Cell>
        </Row>
      ))}
    </DataTable>
  );
}

function WeeklyHits({ data }: { data: Risk }) {
  const max = Math.max(1, ...data.weekly.map((week) => week.total));
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Watchlist hits per week by list">
        {data.weekly.map((week) => (
          <div key={week.weekStart} className="flex h-full flex-1 flex-col justify-end" title={`${week.total} hits`}>
            {data.sources.map((source) =>
              week.bySource[source] ? (
                <div
                  key={source}
                  style={{ height: `${(week.bySource[source] / max) * 100}%`, background: SOURCE_COLORS[source] ?? "#8B929C" }}
                  className="w-full first:rounded-t"
                />
              ) : null,
            )}
            {week.total === 0 ? <div className="h-0.5 w-full bg-sentinel-line-soft" /> : null}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-sentinel-subtle">
        <ClientDate value={data.weekly[0]?.weekStart} format="MMM d" />
        <span>{data.weeks} weeks</span>
        <span>this week</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-sentinel-muted">
        {data.sources.map((source) => (
          <span key={source} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: SOURCE_COLORS[source] ?? "#8B929C" }} />
            {SOURCE_LABELS[source] ?? source}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RiskDashboard() {
  const bounds = useTimeBoundaries();
  const data = useAuthedQuery(anyApi.backOfficeCompliance.riskDashboard, bounds ? { now: bounds.now } : "skip") as Risk | undefined;
  const rejects = data?.outcomes.reduce((sum, row) => sum + row.reject, 0) ?? 0;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Risk</h1>
        <span className="text-[11px] text-sentinel-subtle">Sanctions and PEP hits · fake faces · outcomes · last 13 weeks</span>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-64" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5">
              <StatTile label="Watchlist hits" value={formatNumber(data.totals.hits)} note={`${formatNumber(data.totals.flaggedVerifications)} verifications flagged`} />
              <StatTile label="Critical hits" value={formatNumber(data.totals.critical)} note="strong sanctions matches" tone={data.totals.critical > 0 ? "red" : undefined} />
              <StatTile label="Rejected verifications" value={formatNumber(rejects)} note="all types" />
              <StatTile label="Fake faces caught" value={formatNumber(data.totals.fakeFaces)} note="DeepTrack Live selfie and video" tone={data.totals.fakeFaces > 0 ? "amber" : undefined} />
            </div>

            <Panel>
              <PanelHeader icon={ShieldAlert} title="Watchlist hits per week" hint="by list" />
              {data.totals.hits === 0 ? <EmptyState>No watchlist hits in the last 13 weeks.</EmptyState> : <WeeklyHits data={data} />}
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={Users} title="Hits by client" />
                <CountTable rows={data.byClient} label="Client" empty="No hits." />
              </Panel>
              <Panel>
                <PanelHeader icon={Flag} title="Hits by list" />
                <CountTable rows={data.bySource} label="List" empty="No hits." />
              </Panel>
              <Panel>
                <PanelHeader icon={Globe} title="Hits by matched country" />
                <CountTable rows={data.byCountry} label="Country" empty="No country recorded on any hit." />
              </Panel>
              <Panel>
                <PanelHeader icon={Flag} title="Top programmes and topics" />
                <CountTable rows={data.byProgram} label="Programme / topic" empty="No hits." />
              </Panel>
            </div>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={ShieldAlert} title="Outcomes by verification type" />
                <DataTable
                  head={["Type", "Verifications", "Rejected", "Held for review"]}
                  empty={data.outcomes.length === 0 ? <EmptyState>No verifications in the last 13 weeks.</EmptyState> : null}
                >
                  {data.outcomes.map((row) => (
                    <Row key={row.type}>
                      <Cell>{typeLabel(row.type)}</Cell>
                      <Cell>{formatNumber(row.total)}</Cell>
                      <Cell className={row.reject > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>
                        {formatNumber(row.reject)} ({pct(row.reject, row.total)})
                      </Cell>
                      <Cell className="text-sentinel-muted">
                        {formatNumber(row.review)} ({pct(row.review, row.total)})
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
                {data.truncated ? <p className="px-3.5 py-2 text-[10px] text-sentinel-subtle">Based on the newest 10,000 verifications.</p> : null}
              </Panel>

              <Panel>
                <PanelHeader icon={ScanFace} title="Fake faces caught" hint="DeepTrack Live" />
                <DataTable
                  head={["Client", "Scan ID", "From", "Confidence", "Outcome", "When"]}
                  empty={data.fakeFaces.length === 0 ? <EmptyState>No fake faces caught yet. This fills in once DeepTrack Live is running.</EmptyState> : null}
                >
                  {data.fakeFaces.map((row) => {
                    const badge = verdictBadge(row.verdict, "completed");
                    return (
                      <Row key={row.reference}>
                        <Cell>{row.clientName}</Cell>
                        <Cell className="font-mono text-[11px] text-sentinel-muted">{row.reference}</Cell>
                        <Cell className="text-sentinel-muted">{row.source === "selfie" ? "Selfie" : "Liveness video"}</Cell>
                        <Cell className="text-sentinel-muted">{row.confidencePct === null ? "—" : `${row.confidencePct.toFixed(1)}%`}</Cell>
                        <Cell>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </Cell>
                        <Cell className="text-sentinel-muted">
                          <ClientDate value={row.createdAt} format="MMM d" />
                        </Cell>
                      </Row>
                    );
                  })}
                </DataTable>
              </Panel>
            </div>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}
