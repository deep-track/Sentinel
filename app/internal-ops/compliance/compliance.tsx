"use client";

import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Archive, Download, FileCheck2, History, Inbox } from "lucide-react";
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
  TopBar,
} from "@/components/sentinel/ui";
import { formatNumber } from "@/components/sentinel/format";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;

type AuditData = {
  rows: Array<{
    _id: string;
    timestamp: number;
    action: string;
    actorType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    clientName: string | null;
    metadata: string;
  }>;
  actions: string[];
  clientOptions: Array<{ _id: string; name: string }>;
  hasMore: boolean;
};

type Report = {
  _id: string;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  status: "completed" | "failed";
  verificationCount: number;
  passCount: number;
  reviewCount: number;
  rejectCount: number;
  exportHash: string;
  failureReason?: string;
  signedOffAt?: number;
  signedOffByName?: string;
  signedOffBy?: string;
  signOffNotes?: string;
};

type Requests = {
  requests: Array<{
    _id: string;
    requestType: "access" | "erasure" | "rectification" | "objection";
    subject: string;
    clientName: string | null;
    status: "open" | "in_progress" | "completed" | "rejected";
    receivedAt: number;
    dueAt: number;
    overdue: boolean;
    notes: string | null;
    completedAt: number | null;
  }>;
  retention: Array<{ label: string; count: number; capped: boolean }>;
};

const ACTOR_LABELS: Record<string, string> = {
  internal_admin: "Internal admin",
  reviewer: "Reviewer",
  client_api_key: "Client API key",
  client_user: "Client user",
  system: "System",
};

const RANGES = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: null },
] as const;

const REQUEST_LABELS = { access: "Access", erasure: "Erasure", rectification: "Rectification", objection: "Objection" } as const;
const STATUS_TONES = { open: "amber", in_progress: "blue", completed: "green", rejected: "neutral" } as const;

const selectClass = "rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text";
const inputClass = "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text";

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function Compliance({ canWrite }: { canWrite: boolean }) {
  const bounds = useTimeBoundaries();
  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Compliance</h1>
        <span className="text-[11px] text-sentinel-subtle">Audit log · weekly reports · data subject requests · retention</span>
      </TopBar>
      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {!bounds ? (
          <SkeletonBlock className="h-64" />
        ) : (
          <>
            <AuditLogPanel now={bounds.now} />
            <ReportsPanel canWrite={canWrite} />
            <DataRequestsPanel now={bounds.now} canWrite={canWrite} />
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}

function AuditLogPanel({ now }: { now: number }) {
  const [action, setAction] = useState("");
  const [clientId, setClientId] = useState("");
  const [actorType, setActorType] = useState("");
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  const [limit, setLimit] = useState(PAGE);
  const from = rangeDays === null ? undefined : now - rangeDays * DAY_MS;
  const data = useAuthedQuery(anyApi.backOfficeCompliance.auditLog, {
    limit,
    action: action || undefined,
    clientId: clientId || undefined,
    actorType: actorType || undefined,
    from,
  }) as AuditData | undefined;

  function exportCsv() {
    if (!data) return;
    const header = ["Time (UTC)", "Action", "Actor type", "Actor", "Target type", "Target", "Client", "Details"];
    const rows = data.rows.map((row) => [
      new Date(row.timestamp).toISOString(),
      row.action,
      row.actorType,
      row.actorId,
      row.targetType,
      row.targetId,
      row.clientName,
      row.metadata,
    ]);
    download(
      `sentinel-audit-log-${new Date(now).toISOString().slice(0, 10)}.csv`,
      [header, ...rows].map((line) => line.map((value) => csvCell(value as string | null)).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <Panel>
      <PanelHeader
        icon={History}
        title="Audit log"
        hint="who did what, and when"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={rangeDays ?? "all"} onChange={(event) => { setRangeDays(event.target.value === "all" ? null : Number(event.target.value)); setLimit(PAGE); }} aria-label="Period">
              {RANGES.map((range) => (
                <option key={range.label} value={range.days ?? "all"}>
                  {range.label}
                </option>
              ))}
            </select>
            <select className={selectClass} value={action} onChange={(event) => { setAction(event.target.value); setLimit(PAGE); }} aria-label="Action">
              <option value="">All actions</option>
              {data?.actions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select className={selectClass} value={clientId} onChange={(event) => { setClientId(event.target.value); setLimit(PAGE); }} aria-label="Client">
              <option value="">All clients</option>
              {data?.clientOptions.map((client) => (
                <option key={client._id} value={client._id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select className={selectClass} value={actorType} onChange={(event) => { setActorType(event.target.value); setLimit(PAGE); }} aria-label="Actor type">
              <option value="">All actors</option>
              {Object.entries(ACTOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" onClick={exportCsv} disabled={!data || data.rows.length === 0} className="flex items-center gap-1 text-[11px] text-sentinel-blue-mid disabled:opacity-50">
              <Download className="h-3 w-3" aria-hidden="true" /> Export CSV
            </button>
          </div>
        }
      />
      {data === undefined ? (
        <SkeletonBlock className="m-3 h-32" />
      ) : (
        <>
          <DataTable
            head={["Time", "Action", "Actor", "Target", "Client", "Details"]}
            empty={data.rows.length === 0 ? <EmptyState>No audit entries match these filters.</EmptyState> : null}
          >
            {data.rows.map((row) => (
              <Row key={row._id}>
                <Cell className="whitespace-nowrap text-sentinel-muted">
                  <ClientDate value={row.timestamp} format="MMM d, HH:mm:ss" />
                </Cell>
                <Cell className="font-mono text-[11px]">{row.action}</Cell>
                <Cell className="text-sentinel-muted">
                  {ACTOR_LABELS[row.actorType] ?? row.actorType}
                  <span className="block max-w-[180px] truncate font-mono text-[10px] text-sentinel-subtle" title={row.actorId}>
                    {row.actorId}
                  </span>
                </Cell>
                <Cell className="text-sentinel-muted">
                  {row.targetType}
                  <span className="block max-w-[160px] truncate font-mono text-[10px] text-sentinel-subtle" title={row.targetId}>
                    {row.targetId}
                  </span>
                </Cell>
                <Cell className="text-sentinel-muted">{row.clientName ?? "—"}</Cell>
                <Cell className="max-w-[320px] truncate font-mono text-[10px] text-sentinel-subtle" >
                  <span title={row.metadata}>{row.metadata || "—"}</span>
                </Cell>
              </Row>
            ))}
          </DataTable>
          {data.hasMore ? (
            <div className="px-3.5 py-2">
              <button type="button" onClick={() => setLimit((current) => Math.min(current + PAGE * 5, 2000))} className="text-[11px] text-sentinel-blue-mid" disabled={limit >= 2000}>
                {limit >= 2000 ? "Showing the newest 2,000 entries; narrow the filters to see older ones." : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function ReportsPanel({ canWrite }: { canWrite: boolean }) {
  const convex = useConvex();
  const reports = useAuthedQuery(anyApi.complianceReports.list, { limit: 20 }) as Report[] | undefined;
  const signOff = useMutation(anyApi.backOfficeCompliance.signOffReport);
  const [busy, setBusy] = useState<string | null>(null);

  async function downloadReport(report: Report) {
    setBusy(report._id);
    try {
      const result = (await convex.query(anyApi.complianceReports.getExport, { reportId: report._id })) as
        | { url: string | null; exportHash: string; inline: unknown }
        | null;
      if (!result) throw new Error("Report not found.");
      if (result.url) window.open(result.url, "_blank", "noopener");
      else download(`compliance-report-${new Date(report.periodStart).toISOString().slice(0, 10)}.json`, JSON.stringify(result.inline, null, 2), "application/json");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not download the report."));
    } finally {
      setBusy(null);
    }
  }

  async function signOffReport(report: Report) {
    const notes = window.prompt("Sign off this report. Optional notes for the audit trail:", "");
    if (notes === null) return;
    setBusy(report._id);
    try {
      await signOff({ reportId: report._id, notes: notes || undefined });
      toast.success("Report signed off.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not sign off the report."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelHeader icon={FileCheck2} title="Weekly compliance reports" hint="generated Mondays 04:30 UTC · download, then sign off" />
      {reports === undefined ? (
        <SkeletonBlock className="m-3 h-24" />
      ) : (
        <DataTable
          head={["Period", "Verifications", "Pass · review · reject", "Export hash", "Sign-off", ""]}
          empty={reports.length === 0 ? <EmptyState>No reports generated yet.</EmptyState> : null}
        >
          {reports.map((report) => (
            <Row key={report._id}>
              <Cell>
                <ClientDate value={report.periodStart} format="MMM d" /> – <ClientDate value={report.periodEnd} format="MMM d, yyyy" />
                {report.status === "failed" ? (
                  <span className="ml-1.5">
                    <Badge tone="red">failed</Badge>
                  </span>
                ) : null}
              </Cell>
              <Cell>{formatNumber(report.verificationCount)}</Cell>
              <Cell className="text-sentinel-muted">
                {formatNumber(report.passCount)} · {formatNumber(report.reviewCount)} · {formatNumber(report.rejectCount)}
              </Cell>
              <Cell className="font-mono text-[10px] text-sentinel-subtle" >
                <span title={report.exportHash}>{report.exportHash.slice(0, 16)}…</span>
              </Cell>
              <Cell>
                {report.signedOffAt ? (
                  <span className="text-[11px] text-sentinel-muted">
                    <Badge tone="green">signed off</Badge> {report.signedOffByName ?? report.signedOffBy ?? ""}{" "}
                    <ClientDate value={report.signedOffAt} format="MMM d" />
                  </span>
                ) : (
                  <Badge tone="amber">not signed off</Badge>
                )}
              </Cell>
              <Cell>
                <div className="flex gap-2 text-[11px]">
                  {report.status === "completed" ? (
                    <button type="button" onClick={() => downloadReport(report)} disabled={busy === report._id} className="text-sentinel-blue-mid disabled:opacity-50">
                      Download
                    </button>
                  ) : null}
                  {canWrite && report.status === "completed" && !report.signedOffAt ? (
                    <button type="button" onClick={() => signOffReport(report)} disabled={busy === report._id} className="text-sentinel-blue-mid disabled:opacity-50">
                      Sign off
                    </button>
                  ) : null}
                </div>
              </Cell>
            </Row>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

function DataRequestsPanel({ now, canWrite }: { now: number; canWrite: boolean }) {
  const data = useAuthedQuery(anyApi.backOfficeCompliance.dataRequests, { now }) as Requests | undefined;
  const create = useMutation(anyApi.backOfficeCompliance.createDataRequest);
  const update = useMutation(anyApi.backOfficeCompliance.updateDataRequest);
  const today = new Date(now).toISOString().slice(0, 10);
  const [form, setForm] = useState({ requestType: "erasure", subject: "", receivedAt: today, dueDays: "30", notes: "" });
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const receivedAt = new Date(`${form.receivedAt}T00:00:00`).getTime();
      await create({
        requestType: form.requestType,
        subject: form.subject,
        receivedAt,
        dueAt: receivedAt + Math.max(1, Number(form.dueDays) || 30) * DAY_MS,
        notes: form.notes || undefined,
      });
      setForm((current) => ({ ...current, subject: "", notes: "" }));
      toast.success("Request logged.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not log the request."));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(requestId: string, status: string) {
    try {
      await update({ requestId, status });
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not update the request."));
    }
  }

  const open = data?.requests.filter((row) => row.status === "open" || row.status === "in_progress").length ?? 0;
  const overdue = data?.requests.filter((row) => row.overdue).length ?? 0;

  return (
    <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
      <Panel>
        <PanelHeader icon={Inbox} title="Data subject requests" hint={data ? `${open} open · ${overdue} past due` : undefined} />
        {data === undefined ? (
          <SkeletonBlock className="m-3 h-24" />
        ) : (
          <>
            <DataTable
              head={["Received", "Type", "Subject", "Due", "Status", "Notes"]}
              empty={data.requests.length === 0 ? <EmptyState>No requests logged.</EmptyState> : null}
            >
              {data.requests.map((row) => (
                <Row key={row._id}>
                  <Cell className="text-sentinel-muted">
                    <ClientDate value={row.receivedAt} format="MMM d, yyyy" />
                  </Cell>
                  <Cell>{REQUEST_LABELS[row.requestType]}</Cell>
                  <Cell className="font-mono text-[11px]">{row.subject}</Cell>
                  <Cell>
                    {row.overdue ? <Badge tone="red">overdue</Badge> : <span className="text-sentinel-muted"><ClientDate value={row.dueAt} format="MMM d" /></span>}
                  </Cell>
                  <Cell>
                    {canWrite ? (
                      <select className={selectClass} value={row.status} onChange={(event) => setStatus(row._id, event.target.value)} aria-label="Status">
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    ) : (
                      <Badge tone={STATUS_TONES[row.status]}>{row.status.replace("_", " ")}</Badge>
                    )}
                  </Cell>
                  <Cell className="max-w-[220px] truncate text-sentinel-muted">{row.notes ?? "—"}</Cell>
                </Row>
              ))}
            </DataTable>
            {canWrite ? (
              <div className="grid gap-2 border-t border-sentinel-line p-3.5 text-[12px] sm:grid-cols-5">
                <select className={selectClass} value={form.requestType} onChange={(event) => setForm({ ...form, requestType: event.target.value })} aria-label="Request type">
                  {Object.entries(REQUEST_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input className={`${inputClass} sm:col-span-2`} placeholder="Verification reference (not the person's details)" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
                <input className={inputClass} type="date" value={form.receivedAt} max={today} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} aria-label="Received" />
                <input className={inputClass} inputMode="numeric" value={form.dueDays} onChange={(event) => setForm({ ...form, dueDays: event.target.value })} aria-label="Days to respond" title="Days to respond" />
                <input className={`${inputClass} sm:col-span-4`} placeholder="Notes (optional)" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                <button type="button" onClick={submit} disabled={saving || form.subject.trim().length < 3} className="rounded bg-sentinel-blue px-2 py-1 font-medium text-white disabled:opacity-60">
                  Log request
                </button>
              </div>
            ) : null}
          </>
        )}
        <p className="px-3.5 pb-2 text-[10px] text-sentinel-subtle">
          The response deadline defaults to 30 days; set it to what your legal team confirms under the Data Protection Act. Erasures are carried out by hand; this log is the record.
        </p>
      </Panel>

      <Panel>
        <PanelHeader icon={Archive} title="Records by age" hint="verifications kept" />
        {data === undefined ? (
          <SkeletonBlock className="m-3 h-24" />
        ) : (
          <DataTable head={["Age", "Verifications"]}>
            {data.retention.map((band) => (
              <Row key={band.label}>
                <Cell>{band.label}</Cell>
                <Cell>{band.capped ? `${formatNumber(band.count)}+` : formatNumber(band.count)}</Cell>
              </Row>
            ))}
          </DataTable>
        )}
        <p className="px-3.5 pb-2 text-[10px] text-sentinel-subtle">Sentinel has no automatic retention limit yet; agree one and records past it can be deleted.</p>
      </Panel>
    </div>
  );
}
