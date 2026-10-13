"use client";

import { useMemo } from "react";
import { anyApi } from "convex/server";
import { Database, ScanFace } from "lucide-react";
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
import { formatNumber } from "@/components/sentinel/format";

type Mix = { real: number; fake: number; uncertain: number; error: number; avgConfidencePct: number | null };

type Quality = {
  truncated: boolean;
  months: Array<{ monthStart: number; verifications: number; heldForReview: number; overturned: number; selfie: Mix; video: Mix }>;
  watchlists: Array<{
    sourceKey: string;
    label: string;
    runs: Array<{ fetchedAt: number; status: string; recordCount: number | null; change: number | null; failureReason: string | null }>;
    recordCounts: Array<{ fetchedAt: number; recordCount: number }>;
    failures: number;
  }>;
};

const MONTHS = 6;
const OUTCOMES: Array<{ key: keyof Omit<Mix, "avgConfidencePct">; label: string; color: string }> = [
  { key: "real", label: "Real", color: "#30A46C" },
  { key: "uncertain", label: "Uncertain", color: "#E8A33D" },
  { key: "fake", label: "Fake", color: "#E5484D" },
  { key: "error", label: "Service error", color: "#565C64" },
];

function monthStartsEndingAt(now: number, count: number): number[] {
  const date = new Date(now);
  return Array.from({ length: count }, (_, index) => new Date(date.getFullYear(), date.getMonth() - (count - 1 - index), 1).getTime());
}

function monthLabel(start: number) {
  return new Date(start).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";
}

function total(mix: Mix) {
  return mix.real + mix.fake + mix.uncertain + mix.error;
}

function MixBar({ mix }: { mix: Mix }) {
  const sum = total(mix);
  if (sum === 0) return <span className="text-sentinel-faint">no checks</span>;
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded bg-sentinel-line-soft" role="img" aria-label={OUTCOMES.map((o) => `${o.label} ${mix[o.key]}`).join(", ")}>
      {OUTCOMES.map((outcome) =>
        mix[outcome.key] ? <div key={outcome.key} style={{ width: `${(mix[outcome.key] / sum) * 100}%`, background: outcome.color }} title={`${outcome.label}: ${mix[outcome.key]}`} /> : null,
      )}
    </div>
  );
}

function RecordSparkline({ points }: { points: Quality["watchlists"][number]["recordCounts"] }) {
  if (points.length < 2) return <span className="text-[10px] text-sentinel-faint">not enough history</span>;
  const values = points.map((point) => point.recordCount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const width = 220;
  const height = 36;
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${(index / (points.length - 1)) * width},${height - ((point.recordCount - min) / span) * (height - 4) - 2}`)
    .join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Record count from ${formatNumber(values[0])} to ${formatNumber(values.at(-1) ?? 0)}`}>
      <path d={path} fill="none" stroke="#41ACE4" strokeWidth={1.5} />
    </svg>
  );
}

export function ModelQuality() {
  const bounds = useTimeBoundaries();
  const monthStarts = useMemo(() => (bounds ? monthStartsEndingAt(bounds.now, MONTHS) : null), [bounds]);
  const data = useAuthedQuery(anyApi.backOfficeQuality.quality, monthStarts ? { monthStarts } : "skip") as Quality | undefined;

  const current = data?.months.at(-1);
  const checks = current ? total(current.selfie) + total(current.video) : 0;
  const fakes = current ? current.selfie.fake + current.video.fake : 0;
  const errors = current ? current.selfie.error + current.video.error : 0;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Model &amp; data quality</h1>
        <span className="text-[11px] text-sentinel-subtle">DeepTrack Live · watchlist freshness</span>
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
              <StatTile label="DeepTrack Live checks this month" value={formatNumber(checks)} note="selfie and video" />
              <StatTile label="Judged fake" value={pct(fakes, checks)} note={`${formatNumber(fakes)} checks`} tone={fakes > 0 ? "amber" : undefined} />
              <StatTile label="Service errors" value={pct(errors, checks)} note="checks that couldn't run" tone={errors > 0 ? "red" : undefined} />
              <StatTile
                label="Overturned by reviewers"
                value={pct(current?.overturned ?? 0, current?.verifications ?? 0)}
                note="of verifications DeepTrack Live checked"
              />
            </div>

            <Panel>
              <PanelHeader icon={ScanFace} title="DeepTrack Live by month" hint="verdict mix per check type" />
              <div className="flex flex-wrap gap-3 px-3.5 pt-2.5 text-[11px] text-sentinel-muted">
                {OUTCOMES.map((outcome) => (
                  <span key={outcome.key} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm" style={{ background: outcome.color }} />
                    {outcome.label}
                  </span>
                ))}
              </div>
              <DataTable head={["Month", "Selfie checks", "Selfie mix", "Video checks", "Video mix", "Held for review", "Overturned"]}>
                {data.months.map((month) => (
                  <Row key={month.monthStart}>
                    <Cell>{monthLabel(month.monthStart)}</Cell>
                    <Cell>{formatNumber(total(month.selfie))}</Cell>
                    <Cell>
                      <MixBar mix={month.selfie} />
                    </Cell>
                    <Cell>{formatNumber(total(month.video))}</Cell>
                    <Cell>
                      <MixBar mix={month.video} />
                    </Cell>
                    <Cell className="text-sentinel-muted">{pct(month.heldForReview, month.verifications)}</Cell>
                    <Cell className="text-sentinel-muted">{pct(month.overturned, month.verifications)}</Cell>
                  </Row>
                ))}
              </DataTable>
              <p className="px-3.5 py-2 text-[10px] text-sentinel-subtle">
                Error rates by device and by skin-tone group need the labels from the DeepTrack Live evaluation plan; they&apos;ll appear here once that test set exists.
                {data.truncated ? " Based on the newest 10,000 verifications." : ""}
              </p>
            </Panel>

            <Panel>
              <PanelHeader icon={Database} title="Watchlist freshness" hint="last 30 ingestion runs per list" />
              <div className="grid gap-4 p-3.5 lg:grid-cols-2">
                {data.watchlists.map((list) => (
                  <div key={list.sourceKey} className="space-y-2">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium">{list.label}</span>
                      <span className="text-sentinel-muted">{list.failures} failed run{list.failures === 1 ? "" : "s"}</span>
                    </div>
                    <RecordSparkline points={list.recordCounts} />
                    <DataTable head={["Run", "Status", "Records", "Change"]} empty={list.runs.length === 0 ? <EmptyState>No runs recorded.</EmptyState> : null}>
                      {list.runs.slice(0, 10).map((run) => (
                        <Row key={run.fetchedAt}>
                          <Cell className="text-sentinel-muted">
                            <ClientDate value={run.fetchedAt} format="MMM d, HH:mm" />
                          </Cell>
                          <Cell>
                            <Badge tone={run.status === "active" ? "green" : run.status === "failed" ? "red" : "neutral"}>{run.status}</Badge>
                            {run.failureReason ? <span className="mt-1 block max-w-[220px] truncate text-[10px] text-sentinel-red-text" title={run.failureReason}>{run.failureReason}</span> : null}
                          </Cell>
                          <Cell>{run.recordCount === null ? "—" : formatNumber(run.recordCount)}</Cell>
                          <Cell className={run.change !== null && run.change < 0 ? "text-sentinel-amber" : "text-sentinel-muted"}>
                            {run.change === null ? "—" : `${run.change > 0 ? "+" : ""}${formatNumber(run.change)}`}
                          </Cell>
                        </Row>
                      ))}
                    </DataTable>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}
