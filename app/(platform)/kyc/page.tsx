export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { CheckCircle, Clock3, FileCheck, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { KYCRecord, KYCStatus } from "@/backend/lib/kyc-types";
import { KYCTable } from "@/modules/kyc/kyc-table";

type KYCView = {
  records: KYCRecord[];
  stats: {
    total: number;
    approved: number;
    declined: number;
    pending: number;
    processing: number;
    requires_review: number;
  };
  error?: string;
};

function normalizeStatus(status: string): KYCStatus {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "declined";
  if (status === "PENDING_REVIEW") return "requires_review";
  if (status === "PROCESSING") return "processing";
  if (status === "QUEUED") return "pending";
  return "pending";
}

async function getKYCView(): Promise<KYCView> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { records: [], stats: emptyStats(), error: "Authentication is not configured." };

    const overview = await client.query(anyApi.dashboard.overview, {
      timeRangeMs: 365 * 24 * 60 * 60 * 1000,
      recentLimit: 50,
    });

    // The Convex verification model stores legacy identity verification as `idp`.
    // Treat it as KYC for this customer-facing view; future records may use `kyc`.
    const records: KYCRecord[] = overview.recent
      .filter((row: { type: string }) => row.type === "idp" || row.type === "kyc")
      .map((row: (typeof overview.recent)[number]) => {
        const status = normalizeStatus(row.status);
        const createdAt = new Date(row.createdAt).toISOString();
        return {
          id: row.id,
          reference: row.caseId,
          userId: "",
          userEmail: "",
          userName: row.subjectName ?? "",
          companyId: "",
          status,
          documentType: "identity document",
          createdAt,
          updatedAt: createdAt,
          submittedAt: createdAt,
          riskScore: row.sentinelScore ?? undefined,
        } satisfies KYCRecord;
      });

    return {
      records,
      stats: {
        total: records.length,
        approved: records.filter((row) => row.status === "approved").length,
        declined: records.filter((row) => row.status === "declined").length,
        pending: records.filter((row) => row.status === "pending").length,
        processing: records.filter((row) => row.status === "processing").length,
        requires_review: records.filter((row) => row.status === "requires_review").length,
      },
    };
  } catch (error) {
    console.error("[kyc] Convex query failed", error);
    return { records: [], stats: emptyStats(), error: "KYC data is temporarily unavailable." };
  }
}

function emptyStats() {
  return { total: 0, approved: 0, declined: 0, pending: 0, processing: 0, requires_review: 0 };
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  tone: "slate" | "violet" | "green" | "red" | "orange";
}) {
  const toneClass: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    violet: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    green: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    orange: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneClass[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

export default async function KYCPage() {
  const { records, stats, error } = await getKYCView();

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">KYC Verifications</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Track submissions, review outcomes, and invite users.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
              <Link href="/kyc/new"><FileCheck className="mr-2 h-4 w-4" /> New Verification</Link>
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-800 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard label="Total" value={stats.total} icon={FileCheck} tone="slate" />
          <StatCard label="Approved" value={stats.approved} icon={CheckCircle} tone="green" />
          <StatCard label="Pending + Processing" value={stats.pending + stats.processing} icon={Clock3} tone="violet" />
          <StatCard label="Needs Review" value={stats.requires_review} icon={ShieldAlert} tone="orange" />
          <StatCard label="Declined" value={stats.declined} icon={XCircle} tone="red" />
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <KYCTable records={records} isLoading={false} />
        </div>
      </div>
    </div>
  );
}
