"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { ArrowLeft, ClipboardCheck, FileSearch, ShieldAlert } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Eyebrow,
  Panel,
  PanelHeader,
  Row,
  SentinelCanvas,
  SkeletonBlock,
  TopBar,
} from "@/components/sentinel/ui";
import {
  REVIEW_PRIORITY,
  REVIEW_TRIGGER_LABELS,
  type Verdict,
  type VerificationStatus,
  formatAge,
  formatPct,
  typeLabel,
  verdictBadge,
} from "@/components/sentinel/format";
import { RESOLUTION_LABELS, type ReviewQueueItem, reviewStatusBadge } from "../review-queue";
import { PEP_CLASS_LABELS, RISK_CATEGORY_LABELS, type PepClass, type RiskCategory } from "@/backend/convex/lib/amlCategories";

type VerificationDetail = {
  _id: string;
  type: string;
  reference: string;
  status: VerificationStatus;
  verdict?: Verdict;
  confidence?: number;
  failureReason?: string;
  disputeReason?: string;
  input?: unknown;
  result?: unknown;
  createdAt: number;
  completedAt?: number;
};

type ReviewDetail = Omit<ReviewQueueItem, "verification"> & { verification: VerificationDetail | null };

type AmlMatch = {
  source: string;
  sourceRecordId: string;
  entityName: string;
  program: string;
  matchScore: number;
  matchMethod: string;
  matchedCountry?: string;
  countryMatch?: string;
  riskLevel: string;
  categories?: RiskCategory[];
  pepClass?: PepClass;
  birthDateMatch?: "match" | "mismatch" | "unknown";
  media?: { url: string; domain: string | null; publishedAt: string | null; summary: string; severity: string };
};

type AmlResult = {
  subjectName?: string;
  reason?: string;
  matches?: AmlMatch[];
  coverage?: {
    checkedSources: Array<{ sourceKey: string; fetchedAt: number; stale: boolean }>;
    missingSources: string[];
    staleSources: string[];
  };
};

type Action = "confirm" | "keep_verdict" | "escalate";
type Message = { tone: "ok" | "error"; text: string } | null;

// Must match backend/convex/reviewQueue.ts (MIN_CERTAINTY_PCT).
const MIN_CERTAINTY_PCT = 80;

const ACTIONS: Record<Action, { label: string; outcome: string; needsNotes: boolean; needsCertainty: boolean }> = {
  confirm: { label: "Confirm", outcome: "the automated flag was wrong — final verdict pass", needsNotes: false, needsCertainty: true },
  keep_verdict: { label: "Keep verdict", outcome: "the flag was right — final verdict reject", needsNotes: true, needsCertainty: true },
  escalate: { label: "Escalate", outcome: "insufficient evidence — routed to an engineer, stays open", needsNotes: true, needsCertainty: false },
};

const inputClass =
  "w-full rounded-md border border-sentinel-line bg-sentinel-bg px-2.5 py-1.5 text-[12px] text-sentinel-text placeholder:text-sentinel-subtle focus:border-sentinel-blue focus:outline-none disabled:opacity-50";
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const ACTION_BUTTON: Record<Action, string> = {
  confirm: `${buttonBase} bg-sentinel-green-bg text-sentinel-green-text hover:opacity-90`,
  keep_verdict: `${buttonBase} bg-sentinel-red-bg text-sentinel-red-text hover:opacity-90`,
  escalate: `${buttonBase} border border-sentinel-line text-sentinel-muted hover:border-sentinel-chip hover:text-sentinel-text`,
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-0.5 break-words text-[12px]">{children}</div>
    </div>
  );
}

function asAmlResult(verification: VerificationDetail): AmlResult | null {
  const result = verification.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const candidate = result as AmlResult;
  return Array.isArray(candidate.matches) || candidate.coverage ? candidate : null;
}

export function ReviewItem({ reviewId, canResolve }: { reviewId: string; canResolve: boolean }) {
  const bounds = useTimeBoundaries();
  const item = useAuthedQuery(anyApi.reviewQueue.getForInternalOps, { reviewId }) as ReviewDetail | null | undefined;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <Link
          href="/internal-ops/review-queue"
          className="flex items-center gap-1 text-[11px] text-sentinel-subtle hover:text-sentinel-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Review queue
        </Link>
        <h1 className="text-[15px] font-semibold">
          {item?.verification ? `${typeLabel(item.verification.type)} · ${item.verification.reference}` : "Review item"}
        </h1>
        {item ? <span className="text-[11px] text-sentinel-subtle">{item.clientName ?? "Unknown client"}</span> : null}
      </TopBar>

      {item === undefined ? (
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <SkeletonBlock className="h-32 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      ) : item === null ? (
        <div className="px-5 py-4">
          <Panel>
            <EmptyState>Review item not found.</EmptyState>
          </Panel>
        </div>
      ) : (
        <div className="grid flex-1 gap-3.5 px-5 py-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
          <div className="flex min-w-0 flex-col gap-3.5">
            <ItemSummary item={item} now={bounds?.now ?? null} />
            {item.verification ? (
              <VerificationResult verification={item.verification} />
            ) : (
              <Panel>
                <EmptyState>The underlying verification no longer exists.</EmptyState>
              </Panel>
            )}
          </div>
          <div className="flex flex-col gap-3.5">
            {item.status === "resolved" ? (
              <Resolution item={item} />
            ) : canResolve ? (
              <ResolveForm item={item} />
            ) : (
              <Panel>
                <PanelHeader icon={ClipboardCheck} title="Resolve" />
                <EmptyState>
                  Read-only access: an internal reviewer or admin without the view-only role can resolve review items.
                </EmptyState>
              </Panel>
            )}
          </div>
        </div>
      )}
    </SentinelCanvas>
  );
}

function ItemSummary({ item, now }: { item: ReviewDetail; now: number | null }) {
  const priority = REVIEW_PRIORITY[item.priority];
  const status = reviewStatusBadge(item);
  return (
    <Panel>
      <PanelHeader icon={ClipboardCheck} iconClassName="text-sentinel-blue-mid" title="Review item" />
      <div className="grid grid-cols-2 gap-3 px-3.5 py-3 sm:grid-cols-4">
        <Detail label="Client">
          {item.clientName ? (
            <Link href={`/internal-ops/clients?client=${item.clientId}`} className="hover:text-sentinel-blue-mid">
              {item.clientName}
            </Link>
          ) : (
            "Unknown client"
          )}
        </Detail>
        <Detail label="Trigger">{REVIEW_TRIGGER_LABELS[item.triggerType]}</Detail>
        <Detail label="Priority / status">
          <span className="flex flex-wrap gap-1">
            <Badge tone={priority.tone}>{priority.label}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        </Detail>
        <Detail label="Opened">
          <ClientDate value={item.createdAt} format="MMM d, HH:mm" />
          {now !== null && item.status !== "resolved" ? (
            <span className="text-sentinel-subtle"> · {formatAge(now - item.createdAt)} ago</span>
          ) : null}
        </Detail>
        <div className="col-span-2 sm:col-span-4">
          <Detail label="Trigger reason">{item.triggerReason}</Detail>
        </div>
        {item.status !== "resolved" && item.resolutionNotes ? (
          <div className="col-span-2 sm:col-span-4">
            <Detail label="Escalation notes">{item.resolutionNotes}</Detail>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function VerificationResult({ verification }: { verification: VerificationDetail }) {
  const verdict = verdictBadge(verification.verdict ?? null, verification.status);
  const aml = asAmlResult(verification);
  const coverageGap = aml?.coverage
    ? aml.coverage.missingSources.length > 0 || aml.coverage.staleSources.length > 0
    : false;

  return (
    <>
      <Panel>
        <PanelHeader icon={FileSearch} title="Verification result" hint={verification._id} />
        <div className="grid grid-cols-2 gap-3 px-3.5 py-3 sm:grid-cols-4">
          <Detail label="Type">{typeLabel(verification.type)}</Detail>
          <Detail label="Reference">
            <span className="font-mono text-[11px]">{verification.reference}</span>
          </Detail>
          <Detail label="Automated verdict">
            <Badge tone={verdict.tone} icon={verdict.icon}>
              {verdict.label}
            </Badge>
          </Detail>
          <Detail label="Confidence">{formatPct(verification.confidence)}</Detail>
          {aml?.subjectName ? <Detail label="Subject">{aml.subjectName}</Detail> : null}
          <Detail label="Completed">
            <ClientDate value={verification.completedAt} format="MMM d, HH:mm" />
          </Detail>
          {aml?.reason ? (
            <div className="col-span-2 sm:col-span-4">
              <Detail label="Screening reason">{aml.reason}</Detail>
            </div>
          ) : null}
          {verification.failureReason ? (
            <div className="col-span-2 sm:col-span-4">
              <Detail label="Failure reason">
                <span className="text-sentinel-red-text">{verification.failureReason}</span>
              </Detail>
            </div>
          ) : null}
          {verification.disputeReason ? (
            <div className="col-span-2 sm:col-span-4">
              <Detail label="Client dispute">{verification.disputeReason}</Detail>
            </div>
          ) : null}
        </div>
      </Panel>

      {aml?.coverage ? (
        <Panel>
          <PanelHeader
            icon={ShieldAlert}
            iconClassName={coverageGap ? "text-sentinel-amber" : "text-sentinel-green-text"}
            title="Watchlist coverage"
            hint={coverageGap ? "incomplete at screening time" : "all sources checked"}
          />
          {coverageGap ? (
            <p className="border-b border-sentinel-line px-3.5 py-2 text-[11px] text-sentinel-amber">
              {aml.coverage.missingSources.length > 0 ? `Missing: ${aml.coverage.missingSources.join(", ")}. ` : ""}
              {aml.coverage.staleSources.length > 0 ? `Stale: ${aml.coverage.staleSources.join(", ")}.` : ""}
            </p>
          ) : null}
          <DataTable
            head={["Source", "List fetched", "Freshness"]}
            empty={aml.coverage.checkedSources.length === 0 ? <EmptyState>No sources were checked.</EmptyState> : null}
          >
            {aml.coverage.checkedSources.map((source) => (
              <Row key={source.sourceKey}>
                <Cell>{source.sourceKey}</Cell>
                <Cell className="text-sentinel-subtle">
                  <ClientDate value={source.fetchedAt} format="MMM d, HH:mm" />
                </Cell>
                <Cell>
                  <Badge tone={source.stale ? "amber" : "green"}>{source.stale ? "stale" : "fresh"}</Badge>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>
      ) : null}

      {aml?.matches ? (
        <Panel>
          <PanelHeader
            icon={ShieldAlert}
            iconClassName={aml.matches.length > 0 ? "text-sentinel-red-text" : undefined}
            title="Watchlist matches"
            hint={`${aml.matches.length} match${aml.matches.length === 1 ? "" : "es"}`}
          />
          <DataTable
            head={["Entity", "Category", "Source", "Program", "Score", "Method", "Country", "Risk"]}
            empty={aml.matches.length === 0 ? <EmptyState>No watchlist matches.</EmptyState> : null}
          >
            {aml.matches.map((match) => (
              <Row key={`${match.source}:${match.sourceRecordId}`}>
                <Cell className="max-w-[220px] truncate">
                  {match.media ? (
                    <a href={match.media.url} target="_blank" rel="noopener noreferrer" title={match.media.summary} className="text-sentinel-blue hover:underline">
                      {match.entityName}
                    </a>
                  ) : (
                    <span title={match.entityName}>{match.entityName}</span>
                  )}
                  {match.media ? (
                    <span className="block whitespace-normal text-[10px] text-sentinel-subtle">
                      {[match.media.domain, match.media.publishedAt?.slice(0, 10), `${match.media.severity} severity`].filter(Boolean).join(" · ")}
                      {match.media.summary ? ` — ${match.media.summary}` : ""}
                    </span>
                  ) : null}
                  {match.birthDateMatch && match.birthDateMatch !== "unknown" ? (
                    <span className="block text-[10px] text-sentinel-subtle">
                      date of birth {match.birthDateMatch === "match" ? "matches" : "differs"}
                    </span>
                  ) : null}
                </Cell>
                <Cell>
                  <span className="flex flex-wrap gap-1">
                    {(match.categories ?? []).map((category) => (
                      <span key={category} title={category === "pep" && match.pepClass ? PEP_CLASS_LABELS[match.pepClass] : undefined}>
                        <Badge tone={category === "sanctions" ? "red" : "amber"}>
                          {category === "pep" && match.pepClass ? `PEP Class ${match.pepClass}` : RISK_CATEGORY_LABELS[category]}
                        </Badge>
                      </span>
                    ))}
                    {(match.categories ?? []).length === 0 ? <span className="text-sentinel-subtle">—</span> : null}
                  </span>
                </Cell>
                <Cell className="text-sentinel-muted">
                  {match.source}
                  <span className="ml-1 font-mono text-[10px] text-sentinel-subtle">{match.sourceRecordId}</span>
                </Cell>
                <Cell className="max-w-[180px] truncate text-sentinel-muted">
                  <span title={match.program}>{match.program}</span>
                </Cell>
                <Cell>{match.matchScore}</Cell>
                <Cell className="text-sentinel-muted">{match.matchMethod}</Cell>
                <Cell className="text-sentinel-muted">
                  {match.matchedCountry ?? "—"}
                  {match.countryMatch ? <span className="text-sentinel-subtle"> ({match.countryMatch})</span> : null}
                </Cell>
                <Cell>
                  <Badge tone={match.riskLevel === "critical" ? "red" : "amber"}>{match.riskLevel}</Badge>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Raw record" hint="input (media removed) and provider result" />
        <details className="px-3.5 py-2.5">
          <summary className="cursor-pointer text-[11px] text-sentinel-subtle hover:text-sentinel-text">Show JSON</summary>
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-md bg-sentinel-bg p-2.5 font-mono text-[10px] text-sentinel-muted">
            {JSON.stringify({ input: verification.input ?? null, result: verification.result ?? null }, null, 2)}
          </pre>
        </details>
      </Panel>
    </>
  );
}

function Resolution({ item }: { item: ReviewDetail }) {
  return (
    <Panel>
      <PanelHeader icon={ClipboardCheck} iconClassName="text-sentinel-green-text" title="Resolved" />
      <div className="grid grid-cols-2 gap-3 px-3.5 py-3">
        <Detail label="Outcome">{item.resolutionAction ? RESOLUTION_LABELS[item.resolutionAction] : "—"}</Detail>
        <Detail label="Resolved">
          <ClientDate value={item.resolvedAt} format="MMM d, yyyy HH:mm" />
        </Detail>
        <div className="col-span-2">
          <Detail label="Resolved by">
            <span className="font-mono text-[11px]">{item.resolvedBy ?? "—"}</span>
          </Detail>
        </div>
        {item.resolutionNotes ? (
          <div className="col-span-2">
            <Detail label="Notes">{item.resolutionNotes}</Detail>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ResolveForm({ item }: { item: ReviewDetail }) {
  const resolve = useMutation(anyApi.reviewQueue.resolve);
  const [notes, setNotes] = useState("");
  const [certainty, setCertainty] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const certaintyPct = certainty.trim() === "" ? undefined : Number(certainty);
  const certaintyOk = certaintyPct !== undefined && Number.isFinite(certaintyPct) && certaintyPct >= MIN_CERTAINTY_PCT && certaintyPct <= 100;

  // Same rules as resolveReviewItem; the mutation re-checks them.
  function validate(action: Action): string | null {
    if (ACTIONS[action].needsNotes && !notes.trim()) return `${ACTIONS[action].label} requires notes for the audit trail.`;
    if (ACTIONS[action].needsCertainty && !certaintyOk) {
      return `Certainty must be between ${MIN_CERTAINTY_PCT} and 100% to ${ACTIONS[action].label.toLowerCase()} — escalate instead.`;
    }
    return null;
  }

  async function submit(action: Action) {
    const problem = validate(action);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }
    const subject = item.verification ? `${typeLabel(item.verification.type)} ${item.verification.reference}` : "this item";
    if (!window.confirm(`${ACTIONS[action].label} ${subject}: ${ACTIONS[action].outcome}?`)) return;

    setPending(action);
    setMessage(null);
    try {
      const result = (await resolve({
        reviewId: item._id,
        action,
        notes: notes.trim() || undefined,
        certaintyPct: certaintyPct !== undefined && Number.isFinite(certaintyPct) ? certaintyPct : undefined,
      })) as { status: "escalated" } | { status: "resolved"; verdict: "pass" | "reject" };
      setMessage({
        tone: "ok",
        text: result.status === "escalated" ? "Escalated. The item stays open." : `Resolved — final verdict ${result.verdict}.`,
      });
      setNotes("");
      setCertainty("");
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "Could not resolve this item.") });
    } finally {
      setPending(null);
    }
  }

  return (
    <Panel>
      <PanelHeader icon={ClipboardCheck} iconClassName="text-sentinel-blue-mid" title="Resolve" />
      <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="review-notes" className="text-[10px] font-medium uppercase tracking-[0.05em] text-sentinel-subtle">
            Notes (audit trail)
          </label>
          <textarea
            id="review-notes"
            className={`${inputClass} min-h-[96px] resize-y`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            placeholder="What did you check, and why this outcome?"
          />
          <span className="text-[10px] text-sentinel-subtle">Required for Keep verdict and Escalate.</span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="review-certainty" className="text-[10px] font-medium uppercase tracking-[0.05em] text-sentinel-subtle">
            Certainty %
          </label>
          <input
            id="review-certainty"
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            className={`${inputClass} max-w-[120px]`}
            value={certainty}
            onChange={(event) => setCertainty(event.target.value)}
            placeholder="e.g. 90"
          />
          <span className="text-[10px] text-sentinel-subtle">
            Confirm and Keep verdict need {MIN_CERTAINTY_PCT}–100%. Below that, escalate.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {(Object.keys(ACTIONS) as Action[]).map((action) => (
            <div key={action} className="flex items-center gap-2.5">
              <button
                type="button"
                className={`${ACTION_BUTTON[action]} w-[112px] flex-shrink-0`}
                disabled={pending !== null}
                onClick={() => submit(action)}
              >
                {pending === action ? "Saving…" : ACTIONS[action].label}
              </button>
              <span className="text-[11px] text-sentinel-subtle">{ACTIONS[action].outcome}</span>
            </div>
          ))}
        </div>

        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={message.tone === "error" ? "text-[11px] text-sentinel-red-text" : "text-[11px] text-sentinel-green-text"}
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
