export const dynamic = "force-dynamic";

import Link from "next/link";
import { getKYIList, getKYIStats } from "@/actions/kyi";
import { KYITable } from "@/modules/kyi/kyi-table";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Clock3,
  FileCheck,
  ShieldAlert,
  TrendingUp,
  UserPlus,
  XCircle,
} from "lucide-react";

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  tone: "slate" | "violet" | "green" | "red" | "orange" | "amber";
}) {
  const toneClass: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    violet: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    green: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    orange: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
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

export default async function KYIPage() {
  const [listResult, statsResult] = await Promise.all([getKYIList({ page: 1, limit: 100 }), getKYIStats()]);

  const records = listResult.success ? listResult.data.records : [];
  const stats = statsResult.success
    ? statsResult.data
    : {
        total: records.length,
        approved: records.filter((item) => item.status === "approved").length,
        declined: records.filter((item) => item.status === "declined").length,
        pending: records.filter((item) => item.status === "pending").length,
        processing: records.filter((item) => item.status === "processing").length,
        requires_review: records.filter((item) => item.status === "requires_review").length,
        pepCount: records.filter((item) => item.isPEP).length,
      };

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">KYI Verifications</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Verify and onboard investors with full due diligence
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
              <Link href="/kyi/new">
                <FileCheck className="mr-2 h-4 w-4" /> New Verification
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
          <StatCard label="Total" value={stats.total ?? 0} icon={FileCheck} tone="slate" />
          <StatCard label="Approved" value={stats.approved ?? 0} icon={CheckCircle} tone="green" />
          <StatCard label="Pending + Processing" value={(stats.pending ?? 0) + (stats.processing ?? 0)} icon={Clock3} tone="violet" />
          <StatCard label="Needs Review" value={stats.requires_review ?? 0} icon={ShieldAlert} tone="orange" />
          <StatCard label="Declined" value={stats.declined ?? 0} icon={XCircle} tone="red" />
          <StatCard label="PEP Count" value={stats.pepCount ?? 0} icon={TrendingUp} tone="amber" />
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <KYITable records={records} isLoading={false} />
        </div>
      </div>
    </div>
  );
}
