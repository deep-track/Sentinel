export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { KYCStatus } from "@/backend/lib/kyc-types";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";
import { DownloadReportButton } from "../[id]/report-actions";
import { ClientDate } from "@/components/client-date";

interface KYCDetailPageProps {
  params: Promise<{ id: string }>;
}

type StepResults = {
  liveness?: { livenessScore: number; deepfakeFlag: boolean; confidence: number } | { error: string };
  docScan?: { fakeScore: number; flags: string[]; documentType: string } | { error: string };
  iprs?: { status: string } | { error: string };
  aml?: {
    status: string;
    matches: Array<{ source: string; program: string; matchScore: number; matchedCountry: string | null }>;
  } | { error: string };
};

type VerificationRecord = {
  _id: string;
  clientId: string;
  type: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  confidence?: number | null;
  creditsUsed: number;
  input: unknown;
  result?: StepResults;
  reference: string;
  failureReason?: string | null;
  disputeReason?: string | null;
  disputedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};

function hasError(step: unknown): step is { error: string } {
  return Boolean(step && typeof step === "object" && "error" in step);
}

// Steps only persist a machine-readable code (see
// backend/convex/lib/awsClients/internalFetch.ts UpstreamErrorCode). Unknown
// values — including raw provider text stored by older versions — are never
// shown verbatim.
const STEP_ERROR_TEXT: Record<string, string> = {
  upstream_timeout: "The verification provider timed out before responding.",
  upstream_unavailable: "The verification provider was unavailable.",
  upstream_http_error: "The verification provider returned an error.",
  upstream_invalid_response: "The verification provider returned a response that couldn't be read.",
  upstream_misconfigured: "This check isn't configured on the platform yet.",
  internal_error: "An internal error stopped this check.",
};

function stepErrorText(code: string): string {
  return STEP_ERROR_TEXT[code] ?? "This check could not be completed.";
}

// Rendered in the viewer's timezone, after hydration.
function PreciseTime({ ms }: { ms: number }) {
  return <ClientDate value={ms} format="MMM d, yyyy, h:mm:ss.SSS a" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function normalizeStatus(row: { status: string; verdict?: string | null }): KYCStatus {
  if (row.verdict === "pass") return "approved";
  if (row.verdict === "reject") return "declined";
  if (row.verdict === "review") return "requires_review";
  // A failed run is a terminal outcome, not "pending".
  if (row.status === "failed") return "declined";
  if (row.status === "processing") return "processing";
  return "pending";
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

/**
 * Dashboard KYC submissions made before the liveness fix sent the uploaded
 * still selfie as "liveness frames". Those liveness results don't prove
 * presence and must not be shown as a pass.
 */
function isStillImageLiveness(input: unknown): boolean {
  const rec = inputRecord(input);
  return typeof rec.selfieUrl === "string" && rec.livenessMediaType === "jpeg_frames";
}

function subjectName(input: unknown): string | null {
  if (typeof input === "object" && input !== null && "firstName" in input) {
    const rec = input as Record<string, unknown>;
    const first = typeof rec.firstName === "string" ? rec.firstName : "";
    const last = typeof rec.lastName === "string" ? rec.lastName : "";
    const full = [first, last].filter(Boolean).join(" ");
    return full || null;
  }
  return null;
}

async function getRecord(
  id: string,
): Promise<{ record: VerificationRecord | null; error?: string }> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { record: null, error: "Authentication is not configured." };

    const record: VerificationRecord | null = await client.query(anyApi.verifications.get, { id });
    return { record };
  } catch (error) {
    console.error("[kyc detail] Convex query failed", error);
    return { record: null, error: "Record details are temporarily unavailable." };
  }
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function ResultIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return ok ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
  ) : (
    <XCircle className="h-5 w-5 text-red-600" />
  );
}

// Thresholds mirrored from backend/convex/lib/riskEngine.ts /
// awsClients/*.ts so the report shows the real pass/fail logic, not a
// re-interpretation of it. If those thresholds ever change on the
// backend, this display logic should be updated to match.
function ReportStep({
  title,
  skippedMessage,
  step,
  children,
}: {
  title: string;
  skippedMessage?: string;
  step: unknown;
  children: (data: Record<string, unknown>) => React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
      {!step ? (
        <p className="text-xs text-slate-400 italic">
          {skippedMessage ?? "This step did not run for this verification."}
        </p>
      ) : hasError(step) ? (
        <p className="text-xs text-red-600">
          {stepErrorText(step.error)}
        </p>
      ) : (
        children(step as Record<string, unknown>)
      )}
    </div>
  );
}

export default async function KYCDetailPage({ params }: KYCDetailPageProps) {
  const { id } = await params;
  const { record, error } = await getRecord(id);

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/kyc"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 mb-8"
        >
          <ChevronLeft className="h-4 w-4" /> Back to KYC
        </Link>

        {!record ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
            <p className="text-amber-700 dark:text-amber-400 font-medium">
              {error ?? "This record doesn't exist, or you don't have access to it."}
            </p>
          </div>
        ) : record.type !== "idp" ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
            <p className="text-amber-700 dark:text-amber-400 font-medium">
              This record is a {record.type.toUpperCase()} verification, not an identity (KYC) check.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {subjectName(record.input) ?? "Identity Verification"}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">
                  {record.reference}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <KYCStatusBadge status={normalizeStatus(record)} size="lg" />
                <DownloadReportButton />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <InfoRow label="Type" value={record.type.toUpperCase()} />
              <InfoRow label="Submitted" value={<PreciseTime ms={record.createdAt} />} />
              <InfoRow label="Last updated" value={<PreciseTime ms={record.updatedAt} />} />
              {record.completedAt ? (
                <>
                  <InfoRow label="Completed" value={<PreciseTime ms={record.completedAt} />} />
                  <InfoRow
                    label="Processing time"
                    value={formatDuration(record.completedAt - record.createdAt)}
                  />
                </>
              ) : null}
              {/* `confidence` is a hard-coded 0/1 derived from the verdict for
                  identity checks, so it isn't shown as a score. */}
              {record.failureReason ? (
                <InfoRow label="Failure reason" value={record.failureReason} />
              ) : null}
              {record.disputeReason ? (
                <InfoRow label="Dispute reason" value={record.disputeReason} />
              ) : null}
            </div>

            {normalizeStatus(record) === "requires_review" && record.result && !record.result.liveness ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-4 text-sm text-amber-800 dark:text-amber-300 print:border-slate-300">
                Held for manual review: liveness was not collected, so this verification can&apos;t be
                approved automatically.
              </div>
            ) : null}

            {normalizeStatus(record) === "requires_review" ? (
              <Link
                href={`/kyc/${id}/review`}
                className="inline-block text-sm font-medium text-violet-600 hover:text-violet-700 print:hidden"
              >
                View review status →
              </Link>
            ) : null}

            {/* Verification report — what was actually checked, and why */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                Verification Report
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                Step-by-step results from the identity verification pipeline.
              </p>

              {!record.result ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                  No step-by-step results are stored for this verification.
                </p>
              ) : (
                <div className="space-y-4">
                  <ReportStep
                    title="Document Authenticity"
                    step={record.result.docScan}
                  >
                    {(d) => {
                      const fakeScore = d.fakeScore as number;
                      const flags = d.flags as string[];
                      const passed = fakeScore <= 0.25 && flags.length === 0;
                      return (
                        <div className="flex items-start gap-3">
                          <ResultIcon ok={passed} />
                          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                            <p>Document type: <span className="font-medium">{String(d.documentType)}</span></p>
                            <p>Forgery score: <span className="font-medium">{(fakeScore * 100).toFixed(1)}%</span> (pass threshold: ≤25%)</p>
                            <p>Flags: {flags.length ? flags.join(", ") : "none"}</p>
                          </div>
                        </div>
                      );
                    }}
                  </ReportStep>

                  <ReportStep
                    title="Liveness Check"
                    skippedMessage="Not collected — this verification used the selfie-upload flow, which doesn't include a liveness check. The person's physical presence was not confirmed."
                    step={record.result.liveness}
                  >
                    {(d) => {
                      const livenessScore = d.livenessScore as number;
                      const deepfakeFlag = d.deepfakeFlag as boolean;
                      const stillImage = isStillImageLiveness(record.input);
                      const passed = livenessScore >= 0.85 && !deepfakeFlag;
                      return (
                        <div className="flex items-start gap-3">
                          <ResultIcon ok={stillImage ? null : passed} />
                          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                            {stillImage ? (
                              <p className="font-medium text-amber-700 dark:text-amber-400">
                                Not a valid liveness check: this score was computed from a single uploaded
                                still photo, which can&apos;t prove the person was present.
                              </p>
                            ) : null}
                            <p>Liveness score: <span className="font-medium">{(livenessScore * 100).toFixed(1)}%</span> (pass threshold: ≥85%)</p>
                            <p>Deepfake flagged: <span className="font-medium">{deepfakeFlag ? "Yes" : "No"}</span></p>
                          </div>
                        </div>
                      );
                    }}
                  </ReportStep>

                  <ReportStep title="Identity Registry (IPRS)" step={record.result.iprs}>
                    {(d) => {
                      const status = String(d.status);
                      const passed = status === "MATCH";
                      return (
                        <div className="flex items-start gap-3">
                          <ResultIcon ok={status === "PARTIAL_MATCH" ? null : passed} />
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Status: <span className="font-medium">{status.replace("_", " ")}</span>
                          </p>
                        </div>
                      );
                    }}
                  </ReportStep>

                  <ReportStep title="AML / Sanctions Screening" step={record.result.aml}>
                    {(d) => {
                      const status = String(d.status);
                      const matches = (d.matches as Array<{ source: string; program: string; matchScore: number; matchedCountry: string | null }>) ?? [];
                      const passed = status === "CLEAR";
                      return (
                        <div className="flex items-start gap-3">
                          <ResultIcon ok={status === "PEP" ? null : passed} />
                          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2 flex-1">
                            <p>Status: <span className="font-medium">{status.replace("_", " ")}</span></p>
                            {matches.length > 0 ? (
                              <div className="space-y-1">
                                {matches.map((m, i) => (
                                  <div key={i} className="rounded bg-slate-50 dark:bg-slate-800 px-2 py-1">
                                    {m.source.replace("_", " ")} — {m.program} ({m.matchScore}% match{m.matchedCountry ? `, ${m.matchedCountry}` : ""})
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    }}
                  </ReportStep>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}