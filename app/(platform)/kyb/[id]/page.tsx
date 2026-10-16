export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { countries } from "@/backend/lib/kyb-types";
import { type KYBStatus, KYBStatusBadge } from "@/modules/kyb/kyb-status-badge";
import { DisputeButton } from "@/components/disputes/dispute-button";
import { ReportPdfButton } from "@/components/reports/report-pdf-button";
import { kybReportSpec } from "@/components/reports/kyb-report-spec";
import { RiskRatingDetail, type RatingView } from "@/components/risk/risk-rating";
import { FraudNetworkDetail } from "@/components/risk/fraud-network";
import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";

interface KYBDetailPageProps {
  params: Promise<{ id: string }>;
}

type VerificationRow = {
  _id: string;
  type: string;
  reference: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  failureReason?: string | null;
  input?: unknown;
  result?: unknown;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};

type DirectorRow = {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string;
  shareholding?: string | null;
  idNumber?: string | null;
  status: string;
};

const POSITION_LABELS: Record<string, string> = {
  director: "Director",
  shareholder: "Shareholder",
  beneficial_owner: "Beneficial Owner",
};

function normalizeStatus(row: VerificationRow): KYBStatus {
  if (row.verdict === "pass") return "approved";
  if (row.verdict === "reject") return "declined";
  if (row.verdict === "review") return "requires_review";
  if (row.status === "failed") return "declined";
  if (row.status === "processing") return "processing";
  return "pending";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function httpsUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function maskId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length <= 4 ? value : `${"•".repeat(Math.min(value.length - 4, 6))}${value.slice(-4)}`;
}

async function getRecord(id: string) {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) {
      return { verification: null, directors: [] as DirectorRow[], error: "Your session couldn't be verified. Sign in again." };
    }
    const verification: VerificationRow | null = await client.query(anyApi.verifications.get, { id });
    if (!verification) {
      return { verification: null, directors: [] as DirectorRow[], error: "This record doesn't exist, or you don't have access to it." };
    }
    if (verification.type !== "kyb") {
      return { verification: null, directors: [] as DirectorRow[], error: "This record isn't a business (KYB) verification." };
    }
    const directors: DirectorRow[] = await client.query(anyApi.kyb.getDirectors, { kybVerificationId: id });
    return { verification, directors, error: undefined };
  } catch (error) {
    console.error("[kyb detail] Convex query failed", error);
    return { verification: null, directors: [] as DirectorRow[], error: "Record details are temporarily unavailable." };
  }
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-white text-right">{value}</span>
    </div>
  );
}

function DocumentLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-slate-400">Not provided</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700"
    >
      View <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

type Flag = { code: string; severity: string; message: string };
type Check = { name: string; status: "passed" | "failed" | "not_applicable"; detail?: string };
type KybResult = {
  automated?: boolean;
  reason?: string;
  certificate?: { verdict: string; reason: string; fields?: Record<string, unknown>; flags?: Flag[]; checks?: Check[]; summary?: string };
  proofOfAddress?: { verdict: string; reason: string; flags?: Flag[]; checks?: Check[] };
  registry?: {
    verdict: string;
    reason: string;
    checks?: Check[];
    record?: { companyName?: string | null; registrationNumber?: string | null; registrationDate?: string | null; kraPin?: string | null; shareholders?: Array<{ name: string; shares?: string | null }> };
    lateResponse?: { receivedAt: number; status: string; record?: { companyName?: string | null; active?: boolean | null } };
    ownership?: {
      thresholdPct: number;
      nodes: Array<{ name: string; kind: "person" | "company"; depth: number; directPct: number | null; effectivePct: number | null; note: string | null }>;
      beneficialOwners: string[];
      untraced: string[];
    };
  };
  parties?: Array<{ name: string; role: string; verdict: string; complete: boolean; reason: string; hits: number; suppressed: number }>;
  riskRating?: RatingView;
  fraudNetwork?: NetworkSummary;
};

const VERDICT_STYLE: Record<string, string> = {
  pass: "text-emerald-700 dark:text-emerald-400",
  review: "text-amber-700 dark:text-amber-400",
  reject: "text-red-700 dark:text-red-400",
  unavailable: "text-slate-500",
};
const VERDICT_LABEL: Record<string, string> = { pass: "Passed", review: "Needs review", reject: "Rejected", unavailable: "Not checked" };

function ChecksList({ checks, flags }: { checks?: Check[]; flags?: Flag[] }) {
  return (
    <>
      {checks?.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {checks.map((check) => (
            <li key={check.name} className={check.status === "failed" ? "text-red-700 dark:text-red-400" : check.status === "passed" ? "text-slate-700 dark:text-slate-300" : "text-slate-500"}>
              {check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "–"} {check.name}
              {check.detail ? <span className="text-slate-500"> · {check.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {flags?.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {flags.slice(0, 8).map((flag) => (
            <li key={flag.code} className={flag.severity === "critical" ? "text-red-700 dark:text-red-400" : flag.severity === "high" || flag.severity === "medium" ? "text-amber-700 dark:text-amber-400" : "text-slate-500"}>
              {flag.message}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// The automated KYB checks (kybNode.processKyb).
function AutomatedChecks({ result }: { result: unknown }) {
  const data = (result && typeof result === "object" ? result : {}) as KybResult;
  if (!data.automated) {
    return data.reason ? (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-600 dark:text-slate-300">{data.reason}</div>
    ) : null;
  }
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Automated checks</h2>
        {data.reason ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{data.reason}</p> : null}
      </div>
      {data.riskRating ? (
        <div>
          <p className="mb-1 text-sm font-medium">Customer risk rating</p>
          <RiskRatingDetail rating={data.riskRating} />
        </div>
      ) : null}
      {data.fraudNetwork ? (
        <div>
          <p className="mb-1 text-sm font-medium">Fraud network (directors&apos; ID numbers and emails)</p>
          <FraudNetworkDetail summary={data.fraudNetwork} />
        </div>
      ) : null}
      {data.certificate ? (
        <div>
          <p className="text-sm font-medium">
            Registration certificate: <span className={VERDICT_STYLE[data.certificate.verdict]}>{VERDICT_LABEL[data.certificate.verdict] ?? data.certificate.verdict}</span>
          </p>
          {data.certificate.fields ? (
            <p className="mt-1 text-xs text-slate-500">
              Read as {String(data.certificate.fields.companyName ?? "—")} · no. {String(data.certificate.fields.registrationNumber ?? "—")}
              {data.certificate.fields.incorporationDate ? ` · incorporated ${String(data.certificate.fields.incorporationDate)}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{data.certificate.reason}</p>
          )}
          <ChecksList checks={data.certificate.checks} flags={data.certificate.flags} />
        </div>
      ) : null}
      {data.proofOfAddress ? (
        <div>
          <p className="text-sm font-medium">
            Proof of address: <span className={VERDICT_STYLE[data.proofOfAddress.verdict]}>{VERDICT_LABEL[data.proofOfAddress.verdict] ?? data.proofOfAddress.verdict}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{data.proofOfAddress.reason}</p>
          <ChecksList checks={data.proofOfAddress.checks} flags={data.proofOfAddress.flags} />
        </div>
      ) : null}
      {data.registry ? (
        <div>
          <p className="text-sm font-medium">
            Company registry (Kenya BRS): <span className={VERDICT_STYLE[data.registry.verdict]}>{VERDICT_LABEL[data.registry.verdict] ?? data.registry.verdict}</span>
          </p>
          {data.registry.record ? (
            <p className="mt-1 text-xs text-slate-500">
              {String(data.registry.record.companyName ?? "—")} · no. {String(data.registry.record.registrationNumber ?? "—")}
              {data.registry.record.registrationDate ? ` · registered ${data.registry.record.registrationDate}` : ""}
              {data.registry.record.kraPin ? ` · KRA PIN ${data.registry.record.kraPin}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{data.registry.reason}</p>
          )}
          {data.registry.record?.shareholders?.length ? (
            <p className="mt-1 text-xs text-slate-500">
              Shareholders: {data.registry.record.shareholders.map((holder) => `${holder.name}${holder.shares ? ` (${holder.shares})` : ""}`).join(", ")}
            </p>
          ) : null}
          {data.registry.lateResponse ? (
            <p className="mt-1 text-xs text-amber-600">
              The registry answered after the checks finished: {data.registry.lateResponse.status === "found" ? `${data.registry.lateResponse.record?.companyName ?? "record found"}${data.registry.lateResponse.record?.active === false ? " (not active)" : ""}` : data.registry.lateResponse.status.replace("_", " ")}.
            </p>
          ) : null}
          <ChecksList checks={data.registry.checks} />
          {data.registry.ownership?.nodes.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Ownership · beneficial owners hold {data.registry.ownership.thresholdPct}% or more
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {data.registry.ownership.nodes.map((node, index) => (
                  <li key={`${node.name}-${index}`} style={{ paddingLeft: `${(node.depth - 1) * 1.25}rem` }}>
                    {node.depth > 1 ? <span className="text-slate-400">└ </span> : null}
                    <span className="font-medium">{node.name}</span>{" "}
                    <span className="text-xs text-slate-500">
                      {node.kind === "company" ? "company" : "person"} · holds {node.directPct ?? "?"}% · {node.effectivePct ?? "?"}% of the business
                    </span>
                    {data.registry!.ownership!.beneficialOwners.includes(node.name) ? <span className="ml-1 text-xs font-medium text-amber-700">Beneficial owner</span> : null}
                    {node.note ? <span className="block text-xs text-amber-600">{node.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {data.parties?.length ? (
        <div>
          <p className="text-sm font-medium">AML screening</p>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {data.parties.map((party) => (
              <li key={`${party.role}-${party.name}`} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{party.name}</span> <span className="text-xs text-slate-500">({party.role === "ubo" ? "beneficial owner" : party.role === "shareholder" ? "company shareholder" : party.role})</span>
                  {party.verdict !== "pass" ? <span className="block text-xs text-slate-500">{party.reason.slice(0, 300)}</span> : null}
                </span>
                <span className={`text-xs font-medium ${VERDICT_STYLE[party.verdict]}`}>
                  {party.complete ? VERDICT_LABEL[party.verdict] : "Incomplete"}
                  {party.hits ? ` · ${party.hits} hit${party.hits === 1 ? "" : "s"}` : ""}
                  {party.suppressed ? ` · ${party.suppressed} cleared before` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default async function KYBDetailPage({ params }: KYBDetailPageProps) {
  const { id } = await params;
  const { verification, directors, error } = await getRecord(id);
  const input =
    verification?.input && typeof verification.input === "object"
      ? (verification.input as Record<string, unknown>)
      : {};
  const countryCode = text(input.incorporationCountry);
  const country = countryCode ? (countries.find((c) => c.code === countryCode)?.name ?? countryCode) : "—";
  const status = verification ? normalizeStatus(verification) : null;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/kyb"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 mb-8"
        >
          <ChevronLeft className="h-4 w-4" /> Back to KYB
        </Link>

        {!verification || !status ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
            <p className="text-amber-700 dark:text-amber-400 font-medium">
              {error ?? "This record doesn't exist, or you don't have access to it."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {text(input.businessName) ?? "Business Verification"}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">{verification.reference}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <KYBStatusBadge status={status} size="lg" />
                <ReportPdfButton spec={kybReportSpec(verification, directors, country)} />
                <DisputeButton verificationId={id} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <InfoRow label="Registration number" value={text(input.registrationNumber) ?? "—"} />
              <InfoRow label="Country of incorporation" value={country} />
              {text(input.businessType) ? <InfoRow label="Business type" value={text(input.businessType)} /> : null}
              <InfoRow label="Incorporation certificate" value={<DocumentLink url={httpsUrl(input.registrationDocUrl)} />} />
              <InfoRow label="Proof of address" value={<DocumentLink url={httpsUrl(input.proofOfAddressUrl)} />} />
              <InfoRow label="Submitted" value={formatDate(verification.createdAt)} />
              <InfoRow label="Last updated" value={formatDate(verification.updatedAt)} />
              {verification.completedAt ? <InfoRow label="Completed" value={formatDate(verification.completedAt)} /> : null}
              {verification.failureReason ? <InfoRow label="Failure reason" value={verification.failureReason} /> : null}
            </div>

            <AutomatedChecks result={verification.result} />

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Directors & UBOs ({directors.length})
                </h2>
              </div>
              {directors.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No directors are recorded for this submission.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Name</th>
                        <th className="px-6 py-3">Position</th>
                        <th className="px-6 py-3">Shareholding</th>
                        <th className="px-6 py-3">ID number</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {directors.map((director) => (
                        <tr key={director._id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-6 py-3">
                            <p className="font-medium text-slate-900 dark:text-white">
                              {director.firstName} {director.lastName}
                            </p>
                            <p className="text-xs text-slate-500">{director.email}</p>
                          </td>
                          <td className="px-6 py-3">{POSITION_LABELS[director.position] ?? director.position}</td>
                          <td className="px-6 py-3">{director.shareholding ? `${director.shareholding}%` : "—"}</td>
                          <td className="px-6 py-3 font-mono text-xs">{maskId(director.idNumber)}</td>
                          <td className="px-6 py-3 capitalize">{director.status.replace(/_/g, " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {status === "requires_review" ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                This business needs a person to look at it. Your team decides it on the{" "}
                <Link href="/reviews" className="underline">
                  Reviews
                </Link>{" "}
                page; the status here updates once it&apos;s decided.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
