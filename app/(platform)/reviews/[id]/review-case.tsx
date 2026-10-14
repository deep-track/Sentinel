"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { ChevronLeft, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { CategoryBadge, DueLabel, PriorityBadge, type ReviewSummary } from "../review-parts";
import { StrPanel } from "@/components/reports/str-dialog";

type CaseDetail = ReviewSummary & {
  clientId?: string;
  recommendationNotes: string | null;
  resolutionNotes: string | null;
  result: { status: string; reason: string | null; confidence: number | null; createdAt: number } | null;
  hits: Array<{ entityName: string; source: string; program: string; matchScore: number; categories: string[]; pepClass: number | null; riskLevel: string }>;
  documentFlags: Array<{ code: string; severity: string; message?: string }>;
  maker: { userId: string; name: string } | null;
  rules: {
    fourEyes: boolean;
    clearanceRole: string;
    clearanceLabel: string;
    makerChecker: boolean;
    requireReasonCode: boolean;
    approveReasons: string[];
    rejectReasons: string[];
  };
  me: {
    userId: string;
    role: string;
    canWork: boolean;
    canAssignOthers: boolean;
    decision: { canAct: boolean; final: boolean; reason: string | null };
    canSendBack: boolean;
  };
  history: Array<{ _id: string; action: string; actorName: string; at: number; notes: string | null; reasonCode: string | null }>;
};

type Member = { userId: string; name: string; role: string };

const HISTORY_LABELS: Record<string, string> = {
  "verification.created": "Ran the check",
  "aml.screened": "Screening completed",
  "aml.monitoring_alert": "Monitoring alert raised",
  "document.verified": "Document check completed",
  "review.assigned": "Assignment changed",
  "review.recommended": "Recommended a decision",
  "review.sent_back": "Sent the recommendation back",
  "review.client_escalated": "Escalated the case",
  "review.overdue": "Missed the review deadline",
  "review.confirm": "Approved",
  "review.keep_verdict": "Rejected",
  "review.escalate": "Escalated to DeepTrack engineering",
};

export function ReviewCase({ reviewId }: { reviewId: string }) {
  const data = useAuthedQuery(anyApi.clientReviews.get, { reviewId }) as CaseDetail | null | undefined;

  if (data === undefined) return <Skeleton className="h-96 w-full" />;
  if (data === null) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">This case doesn&apos;t exist, or you don&apos;t have access to it.</Card>;
  }
  const closed = data.status === "resolved";

  return (
    <>
      <Link href="/reviews" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to reviews
      </Link>

      <Card className="p-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{data.queueLabel} case</p>
            <h1 className="text-2xl font-bold text-foreground">{data.verification?.subject ?? "Case"}</h1>
            <p className="font-mono text-xs text-muted-foreground">{data.verification?.reference}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={data.category} label={data.categoryLabel} />
            <PriorityBadge priority={data.priority} escalated={Boolean(data.escalatedAt)} />
          </div>
        </div>
        <p className="text-sm text-foreground">{data.result?.reason ?? data.triggerReason}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            Opened <ClientDate value={data.createdAt} format="PPp" />
          </span>
          {!closed ? (
            <span>
              Due <DueLabel dueAt={data.dueAt} overdue={data.overdue} />
            </span>
          ) : null}
          {data.maker ? <span>Check run by {data.maker.name}</span> : null}
        </div>
        {data.verification?.href ? (
          <Link href={data.verification.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            Open the full report <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </Card>

      {data.hits.length > 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Hits</h2>
          <div className="mt-3 divide-y rounded-lg border">
            {data.hits.map((hit, index) => (
              <div key={`${hit.entityName}-${index}`} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-medium">{hit.entityName}</p>
                  <p className="text-xs text-muted-foreground">
                    {hit.source.replace(/_/g, " ")} · {hit.program}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {hit.categories.join(", ") || "sanctions"}
                  {hit.pepClass ? ` · PEP Class ${hit.pepClass}` : ""} · score {hit.matchScore} · {hit.riskLevel}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {data.documentFlags.length > 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Document flags</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.documentFlags.map((flag) => (
              <li key={flag.code}>
                <span className={`font-medium ${flag.severity === "critical" ? "text-red-700" : flag.severity === "high" ? "text-amber-700" : ""}`}>{flag.severity}</span>
                {" · "}
                {flag.message ?? flag.code}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {closed ? <Outcome data={data} /> : <WorkPanel data={data} reviewId={reviewId} />}

      {data.verification && ["client_admin", "reviewer", "internal_admin"].includes(data.me.role) ? (
        <StrPanel
          verificationId={data.verification._id}
          reviewId={reviewId}
          defaultReason={[
            `${data.categoryLabel} on ${data.verification.subject} (Sentinel ${data.verification.reference}).`,
            data.result?.reason ?? data.triggerReason,
            ...data.hits.slice(0, 5).map((hit) => `Hit: ${hit.entityName} (${hit.source.replace(/_/g, " ")}, ${hit.program}, score ${hit.matchScore}).`),
          ].join(" ")}
        />
      ) : null}

      <Card className="p-6">
        <h2 className="text-base font-semibold">History</h2>
        <ol className="mt-3 space-y-3 border-l pl-4">
          {data.history.map((entry) => (
            <li key={entry._id} className="text-sm">
              <p>
                <span className="font-medium">{entry.actorName}</span> · {HISTORY_LABELS[entry.action] ?? entry.action}
              </p>
              <p className="text-xs text-muted-foreground">
                <ClientDate value={entry.at} format="PPpp" />
                {entry.reasonCode ? ` · ${entry.reasonCode}` : ""}
              </p>
              {entry.notes ? <p className="mt-1 text-sm text-muted-foreground">“{entry.notes}”</p> : null}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

function Outcome({ data }: { data: CaseDetail }) {
  const resolution = data.resolution!;
  return (
    <Card className={`p-6 ${resolution.verdict === "pass" ? "border-emerald-300" : "border-red-300"}`}>
      <h2 className="text-base font-semibold">{resolution.verdict === "pass" ? "Approved" : resolution.verdict === "reject" ? "Rejected" : "Closed"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {resolution.byName ? `By ${resolution.byName}` : ""}
        {resolution.source === "deeptrack" ? " (DeepTrack)" : ""}
        {resolution.at ? (
          <>
            {" "}
            · <ClientDate value={resolution.at} format="PPpp" />
          </>
        ) : null}
        {data.recommendation ? ` · recommended by ${data.recommendation.byName}` : ""}
      </p>
      {resolution.reasonCode ? <p className="mt-2 text-sm">Reason: {resolution.reasonCode}</p> : null}
      {data.resolutionNotes ? <p className="mt-2 text-sm text-muted-foreground">“{data.resolutionNotes}”</p> : null}
    </Card>
  );
}

function WorkPanel({ data, reviewId }: { data: CaseDetail; reviewId: string }) {
  const { me, rules } = data;
  return (
    <Card className="p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Decision</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.categoryLabel} cases need a {rules.clearanceLabel} or above for the final decision
          {rules.fourEyes ? ", and two people (four-eyes)" : ""}
          {rules.makerChecker ? "; whoever ran the check can't make the final decision" : ""}.
        </p>
      </div>
      {data.recommendation ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">
            {data.recommendation.byName} recommends: {data.recommendation.action === "approve" ? "Approve" : "Reject"}
            {data.recommendation.reasonCode ? ` (${data.recommendation.reasonCode})` : ""}
          </p>
          {data.recommendationNotes ? <p className="mt-1">“{data.recommendationNotes}”</p> : null}
          <p className="mt-1 text-xs">
            <ClientDate value={data.recommendation.at} format="PPp" />
          </p>
        </div>
      ) : null}
      {me.canWork ? <Assignment data={data} reviewId={reviewId} /> : null}
      {me.decision.canAct ? <DecisionForm data={data} reviewId={reviewId} /> : me.canWork ? <p className="text-sm text-muted-foreground">{me.decision.reason}</p> : <p className="text-sm text-muted-foreground">Your role can view this case but not act on it.</p>}
      {me.canWork ? <SecondaryActions data={data} reviewId={reviewId} /> : null}
    </Card>
  );
}

function Assignment({ data, reviewId }: { data: CaseDetail; reviewId: string }) {
  const assign = useMutation(anyApi.clientReviews.assign);
  const members = useAuthedQuery(anyApi.team.assignableMembers, data.me.canAssignOthers && data.clientId ? { clientId: data.clientId } : "skip") as Member[] | undefined;
  const [busy, setBusy] = useState(false);
  const mine = data.assignee?.userId === data.me.userId;

  async function run(to: string) {
    setBusy(true);
    try {
      await assign({ reviewId, to });
    } catch (error) {
      toast.error(getErrorMessage(error, "The assignment couldn't be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">Assigned to</span>
      {data.me.canAssignOthers && members ? (
        <select
          aria-label="Assign to"
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          disabled={busy}
          value={data.assignee?.userId ?? ""}
          onChange={(event) => void run(event.target.value || "nobody")}
        >
          <option value="">Nobody</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
          {data.assignee && !members.some((member) => member.userId === data.assignee!.userId) ? <option value={data.assignee.userId}>{data.assignee.name}</option> : null}
        </select>
      ) : (
        <span className="font-medium">{data.assignee?.name ?? "Nobody"}</span>
      )}
      {!mine && (!data.assignee || data.me.canAssignOthers) ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run("me")}>
          Take it
        </Button>
      ) : null}
      {mine ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run("nobody")}>
          Release
        </Button>
      ) : null}
    </div>
  );
}

function DecisionForm({ data, reviewId }: { data: CaseDetail; reviewId: string }) {
  const decide = useMutation(anyApi.clientReviews.decide);
  const [action, setAction] = useState<"approve" | "reject">(data.recommendation?.action ?? "approve");
  const [reasonCode, setReasonCode] = useState(data.recommendation?.reasonCode ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const reasons = action === "approve" ? data.rules.approveReasons : data.rules.rejectReasons;
  const final = data.me.decision.final;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = (await decide({ reviewId, action, reasonCode: reasonCode || undefined, notes: notes.trim() || undefined })) as { final: boolean };
      toast.success(result.final ? (action === "approve" ? "Case approved" : "Case rejected") : "Recommendation sent for approval");
      setNotes("");
    } catch (error) {
      toast.error(getErrorMessage(error, "The decision couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{final ? (data.recommendation ? "Final decision (second approval)" : "Your decision") : "Your recommendation"}</p>
      {!final ? <p className="text-xs text-muted-foreground">This case needs a second person, so your decision is sent to someone with clearance to approve.</p> : null}
      <div className="flex gap-2">
        {(["approve", "reject"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setAction(value);
              setReasonCode("");
            }}
            aria-pressed={action === value}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium ${
              action === value ? (value === "approve" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-red-600 bg-red-50 text-red-800") : "border-border"
            }`}
          >
            {value === "approve" ? "Approve (clear the flag)" : "Reject"}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-sm font-medium">
          Reason{data.rules.requireReasonCode ? "" : " (optional)"}
        </label>
        <select id="reason" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} required={data.rules.requireReasonCode}>
          <option value="">Choose a reason…</option>
          {reasons.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea id="notes" rows={3} maxLength={2000} className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What you checked and why (kept in the audit log)" />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {final ? (action === "approve" ? "Approve case" : "Reject case") : "Send recommendation"}
      </Button>
    </form>
  );
}

function SecondaryActions({ data, reviewId }: { data: CaseDetail; reviewId: string }) {
  const sendBack = useMutation(anyApi.clientReviews.sendBack);
  const escalate = useMutation(anyApi.clientReviews.escalate);
  const [busy, setBusy] = useState(false);

  async function ask(kind: "escalate" | "sendBack") {
    const notes = window.prompt(kind === "escalate" ? "Why are you escalating this case?" : "Why are you sending the recommendation back?");
    if (!notes?.trim()) return;
    setBusy(true);
    try {
      if (kind === "escalate") await escalate({ reviewId, notes });
      else await sendBack({ reviewId, notes });
      toast.success(kind === "escalate" ? "Case escalated" : "Recommendation sent back");
    } catch (error) {
      toast.error(getErrorMessage(error, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {data.me.canSendBack ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void ask("sendBack")}>
          Send recommendation back
        </Button>
      ) : null}
      {!data.escalatedAt ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void ask("escalate")}>
          Escalate for a senior decision
        </Button>
      ) : null}
    </div>
  );
}
