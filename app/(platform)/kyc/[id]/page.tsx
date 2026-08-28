export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { KYCStatus } from "@/backend/lib/kyc-types";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";

interface KYCDetailPageProps {
  params: Promise<{ id: string }>;
}

type VerificationRecord = {
  _id: string;
  clientId: string;
  type: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  confidence?: number | null;
  creditsUsed: number;
  input: unknown;
  result?: unknown;
  reference: string;
  failureReason?: string | null;
  disputeReason?: string | null;
  disputedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};

function normalizeStatus(row: { status: string; verdict?: string | null }): KYCStatus {
  if (row.verdict === "pass") return "approved";
  if (row.verdict === "reject") return "declined";
  if (row.verdict === "review") return "requires_review";
  if (row.status === "processing") return "processing";
  if (row.status === "queued") return "pending";
  return "pending";
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
              <KYCStatusBadge status={normalizeStatus(record)} size="lg" />
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <InfoRow label="Type" value={record.type.toUpperCase()} />
              <InfoRow
                label="Submitted"
                value={new Date(record.createdAt).toLocaleString()}
              />
              <InfoRow
                label="Last updated"
                value={new Date(record.updatedAt).toLocaleString()}
              />
              {record.completedAt ? (
                <InfoRow
                  label="Completed"
                  value={new Date(record.completedAt).toLocaleString()}
                />
              ) : null}
              {record.confidence != null ? (
                <InfoRow
                  label="Confidence score"
                  value={`${Math.round(record.confidence * 100)}%`}
                />
              ) : null}
              {record.failureReason ? (
                <InfoRow label="Failure reason" value={record.failureReason} />
              ) : null}
              {record.disputeReason ? (
                <InfoRow label="Dispute reason" value={record.disputeReason} />
              ) : null}
            </div>

            {normalizeStatus(record) === "requires_review" ? (
              <Link
                href={`/kyc/${id}/review`}
                className="inline-block text-sm font-medium text-violet-600 hover:text-violet-700"
              >
                View review status →
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
