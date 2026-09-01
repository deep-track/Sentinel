export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { KYIStatus } from "@/backend/lib/kyi-types";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";

interface KYIDetailPageProps {
  params: Promise<{ id: string }>;
}

type VerificationRow = {
  _id: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  confidence?: number | null;
  failureReason?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};

type KyiRecord = {
  firstName: string;
  lastName: string;
  email: string;
  investorType: string;
  accreditationStatus: string;
  sourceOfFunds: string;
  netWorthRange?: string | null;
  investmentAmount?: number | null;
  investmentCurrency?: string | null;
  isPEP: boolean;
};

function normalizeStatus(row: VerificationRow): KYIStatus {
  if (row.status === "completed") {
    if (row.verdict === "reject") return "declined";
    if (row.verdict === "review") return "requires_review";
    return "approved";
  }
  if (row.status === "failed") return "declined";
  if (row.status === "processing") return "processing";
  return "pending";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

async function getRecord(id: string) {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { verification: null, profile: null, error: "Authentication is not configured." };

    const verification: VerificationRow | null = await client.query(anyApi.verifications.get, { id });
    if (!verification) {
      return { verification: null, profile: null, error: "This record doesn't exist, or you don't have access to it." };
    }
    const profile: KyiRecord | null = await client.query(anyApi.kyi.getByVerification, { verificationId: id });
    return { verification, profile };
  } catch (error) {
    console.error("[kyi detail] Convex query failed", error);
    return { verification: null, profile: null, error: "Record details are temporarily unavailable." };
  }
}

export default async function KYIDetailPage({ params }: KYIDetailPageProps) {
  const { id } = await params;
  const { verification, profile, error } = await getRecord(id);

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/kyi"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 mb-8"
        >
          <ChevronLeft className="h-4 w-4" /> Back to KYI
        </Link>

        {!verification ? (
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
                  {profile ? `${profile.firstName} ${profile.lastName}` : "Investor Verification"}
                </h1>
                {profile?.email ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{profile.email}</p>
                ) : null}
              </div>
              <KYIStatusBadge status={normalizeStatus(verification)} />
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <InfoRow label="Submitted" value={new Date(verification.createdAt).toLocaleString()} />
              <InfoRow label="Last updated" value={new Date(verification.updatedAt).toLocaleString()} />
              {verification.completedAt ? (
                <InfoRow label="Completed" value={new Date(verification.completedAt).toLocaleString()} />
              ) : null}
              {profile ? (
                <>
                  <InfoRow label="Investor type" value={profile.investorType} />
                  <InfoRow label="Accreditation" value={profile.accreditationStatus} />
                  <InfoRow label="Source of funds" value={profile.sourceOfFunds} />
                  {profile.netWorthRange ? <InfoRow label="Net worth range" value={profile.netWorthRange} /> : null}
                  {profile.investmentAmount ? (
                    <InfoRow
                      label="Investment amount"
                      value={`${profile.investmentCurrency ?? ""} ${profile.investmentAmount.toLocaleString()}`}
                    />
                  ) : null}
                  <InfoRow label="PEP" value={profile.isPEP ? "Yes" : "No"} />
                </>
              ) : null}
              {verification.failureReason ? (
                <InfoRow label="Failure reason" value={verification.failureReason} />
              ) : null}
            </div>

            {normalizeStatus(verification) === "requires_review" ? (
              <Link
                href={`/kyi/${id}/review`}
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
