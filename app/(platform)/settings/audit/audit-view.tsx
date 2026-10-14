"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import {
  Field,
  ReadOnlyNotice,
  SaveBar,
  Section,
  inputClass,
  useDraft,
  useSave,
  useSettings,
} from "@/components/settings/kit";

type Area = "all" | "team" | "reviews" | "settings" | "checks";
const AREAS: Array<{ value: Area; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "team", label: "Team" },
  { value: "reviews", label: "Review decisions" },
  { value: "settings", label: "Settings, API keys & webhooks" },
  { value: "checks", label: "Checks" },
];

// Plain-English names for the audit actions.
const ACTION_LABELS: Record<string, string> = {
  "team.invite_created": "Invited a team member",
  "team.invite_renewed": "Renewed an invitation",
  "team.invite_revoked": "Revoked an invitation",
  "team.invite_accepted": "Joined the team",
  "team.role_changed": "Changed a role",
  "team.queues_changed": "Changed review queues",
  "team.member_deactivated": "Deactivated a member",
  "team.member_reactivated": "Reactivated a member",
  "team.member_removed": "Removed a member",
  "client.created": "Account opened (DeepTrack)",
  "client.updated": "Account settings changed (DeepTrack)",
  "client.credits_adjusted": "Credits added or adjusted (DeepTrack)",
  "membership.created": "Added a member (DeepTrack)",
  "membership.updated": "Updated a member (DeepTrack)",
  "membership.deactivated": "Deactivated a member (DeepTrack)",
  "review.assigned": "Assigned a case",
  "review.recommended": "Recommended a decision",
  "review.sent_back": "Sent a recommendation back",
  "review.client_escalated": "Escalated a case",
  "review.overdue": "Case missed its deadline",
  "review.confirm": "Approved a case",
  "review.keep_verdict": "Rejected a case",
  "review.escalate": "Escalated to DeepTrack engineering",
  "settings.review_updated": "Changed the review workflow",
  "settings.screening_updated": "Changed screening rules",
  "settings.notifications_updated": "Changed notifications",
  "settings.security_updated": "Changed security settings",
  "settings.data_updated": "Changed data retention",
  "settings.profile_updated": "Changed the organization profile",
  "api_key.created": "Created an API key",
  "api_key.rotated": "Rotated an API key",
  "api_key.updated": "Edited an API key",
  "api_key.revoked": "Revoked an API key",
  "webhook.configured": "Set the webhook endpoint",
  "webhook.events_updated": "Changed webhook events",
  "verification.created": "Ran a check",
  "aml.screened": "AML screening completed",
  "aml.monitoring_alert": "Monitoring alert",
  "aml.monitoring_removed": "Stopped monitoring a subject",
  "document.verified": "Document check completed",
};

type Row = {
  _id: string;
  timestamp: number;
  action: string;
  actorType: string;
  actorName: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
};

function detail(row: Row): string {
  const meta = row.metadata ?? {};
  const parts: string[] = [];
  for (const key of ["email", "role", "reasonCode", "reason", "notes", "reference", "verdict", "finalVerdict"]) {
    const value = meta[key];
    if (typeof value === "string" && value) parts.push(`${key === "reasonCode" ? "reason" : key}: ${value}`);
  }
  if (typeof meta.amount === "number") parts.push(`${meta.amount > 0 ? "+" : ""}${meta.amount.toLocaleString("en-US")} credits`);
  const before = meta.before as unknown;
  const after = meta.after as unknown;
  if ((typeof before === "string" || typeof before === "number") && (typeof after === "string" || typeof after === "number")) parts.push(`${before} → ${after}`);
  else if (before && after && typeof before === "object" && typeof after === "object") {
    const changed = Object.keys(after as Record<string, unknown>).map((key) => `${key}: ${String((before as Record<string, unknown>)[key])} → ${String((after as Record<string, unknown>)[key])}`);
    if (changed.length && changed.length <= 4 && !row.action.startsWith("settings.")) parts.push(changed.join(", "));
  }
  return parts.join(" · ").slice(0, 300);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function AuditView({ clientId, role }: { clientId: string; role: string }) {
  return (
    <>
      <AuditLog clientId={clientId} />
      {role === "client_admin" ? <Retention clientId={clientId} /> : null}
    </>
  );
}

function AuditLog({ clientId }: { clientId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [area, setArea] = useState<Area>("all");
  const { results, status, loadMore } = usePaginatedQuery(
    anyApi.auditLog.listForClient,
    isAuthenticated ? { clientId, ...(area === "all" ? {} : { area }) } : "skip",
    { initialNumItems: 100 },
  );
  const rows = results as Row[];

  function download() {
    const header = ["Time (UTC)", "Who", "Actor type", "Action", "Target type", "Target id", "Details"];
    const lines = rows.map((row) => [new Date(row.timestamp).toISOString(), row.actorName, row.actorType, row.action, row.targetType, row.targetId, row.metadata]);
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sentinel-audit-log-${area}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Audit log</h2>
          <p className="text-sm text-muted-foreground">Who did what, and when: invitations, role changes, decisions, overrides and setting changes. Entries can&apos;t be edited or deleted.</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Filter" className={`${inputClass} w-56`} value={area} onChange={(event) => setArea(event.target.value as Area)}>
            {AREAS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={download} disabled={rows.length === 0}>
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
        </div>
      </div>
      {status === "LoadingFirstPage" ? (
        <div className="p-5">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No entries{area === "all" ? "" : " of this kind"} yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Who</th>
                <th className="p-3">What</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id} className="border-b last:border-0 align-top">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    <ClientDate value={row.timestamp} format="PPp" />
                  </td>
                  <td className="p-3">{row.actorName}</td>
                  <td className="p-3">
                    {ACTION_LABELS[row.action] ?? row.action}
                    <span className="block font-mono text-[11px] text-muted-foreground">{row.action}</span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{detail(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="border-t p-4 text-center">
          <Button type="button" variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(100)}>
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      <p className="border-t px-5 py-2 text-xs text-muted-foreground">The CSV holds the entries loaded above; load more first for a longer period.</p>
    </Card>
  );
}

type RetentionReport = { retentionMonths: number; cutoff: number; pastRetention: number; pastRetentionCapped: boolean; oldestRecordAt: number | null };

function Retention({ clientId }: { clientId: string }) {
  const data = useSettings(clientId);
  const report = useAuthedQuery(anyApi.orgSettings.retentionReport, { clientId }) as RetentionReport | undefined;
  const { draft, setDraft, dirty, reset } = useDraft<{ retentionMonths: number }>(data?.settings.data);
  const save = useMutation(anyApi.orgSettings.saveData);
  const { saving, run } = useSave();
  if (!data || !draft) return null;
  const { limits } = data.options;
  return (
    <>
      <ReadOnlyNotice canEdit={data.canEdit} />
      <Section
        title="Data retention"
        description={`How long customer due diligence records are kept. Kenya's Proceeds of Crime and Anti-Money Laundering Act requires at least 7 years (${limits.minRetentionMonths} months).`}
      >
        <Field label="Keep records for (months)" htmlFor="retention" hint={`${limits.minRetentionMonths}–${limits.maxRetentionMonths} months. Sentinel never deletes records automatically; records past the period are listed for your compliance officer to approve removal with DeepTrack.`}>
          <input
            id="retention"
            type="number"
            min={limits.minRetentionMonths}
            max={limits.maxRetentionMonths}
            className={`${inputClass} sm:w-40`}
            disabled={!data.canEdit}
            value={draft.retentionMonths}
            onChange={(event) => setDraft({ retentionMonths: Number(event.target.value) })}
          />
        </Field>
        {report ? (
          <p className="text-sm text-muted-foreground">
            {report.pastRetention === 0 ? (
              <>No records are past the retention period yet.</>
            ) : (
              <>
                {report.pastRetentionCapped ? "More than 1,000" : report.pastRetention.toLocaleString("en-US")} check{report.pastRetention === 1 ? " is" : "s are"} older than{" "}
                <ClientDate value={report.cutoff} format="PP" />.
              </>
            )}
            {report.oldestRecordAt ? (
              <>
                {" "}
                Oldest record: <ClientDate value={report.oldestRecordAt} format="PP" />.
              </>
            ) : null}
          </p>
        ) : null}
      </Section>
      <SaveBar canEdit={data.canEdit} dirty={dirty} saving={saving} onReset={reset} onSave={() => void run(() => save({ clientId, data: draft }))} />
    </>
  );
}
