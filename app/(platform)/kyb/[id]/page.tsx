export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { countries } from "@/backend/lib/kyb-types";
import { type KYBStatus, KYBStatusBadge } from "@/modules/kyb/kyb-status-badge";

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
              <KYBStatusBadge status={status} size="lg" />
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
                This submission is with our compliance team for manual document and UBO review. No action is
                needed — the status here updates once it&apos;s resolved.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
