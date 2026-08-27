export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { Button } from "@/components/ui/button";
import { KYBTable } from "@/modules/kyb/kyb-table";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { KYBRecord } from "@/backend/lib/types/kyb";
import { Building2, CheckCircle, FileCheck, ShieldAlert } from "lucide-react";

function toStatus(row: any): KYBRecord["status"] {
  if (row.verdict === "pass") return "approved";
  if (row.verdict === "reject") return "declined";
  if (row.verdict === "review") return "requires_review";
  if (row.status === "processing") return "processing";
  if (row.status === "failed") return "declined";
  return "pending";
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ElementType; tone: string }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    violet: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    green: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    orange: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  };
  return <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><div className="flex items-center justify-between"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><div className={`h-8 w-8 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon className="h-4 w-4" /></div></div><p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p></div>;
}

export default async function KYBPage() {
  let records: KYBRecord[] = [];
  let error: string | undefined;
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) throw new Error("Authentication or Convex is not configured.");
    const response = await client.query(anyApi.verifications.list, { type: "kyb", limit: 100 });
    records = response.records.map((row: any) => {
      const input = row.input && typeof row.input === "object" ? row.input : {};
      return { id: row._id, businessName: input.businessName ?? input.companyName ?? "Unnamed business", reference: row.reference, country: input.country ?? input.countryOfIncorporation ?? "—", status: toStatus(row), createdAt: new Date(row.createdAt).toISOString() };
    });
  } catch (cause) {
    console.error("[kyb] Convex query failed", cause);
    error = "KYB data is temporarily unavailable.";
  }
  const stats = {
    total: records.length,
    approved: records.filter((row) => row.status === "approved").length,
    declined: records.filter((row) => row.status === "declined").length,
    pending: records.filter((row) => row.status === "pending").length,
    processing: records.filter((row) => row.status === "processing").length,
    requires_review: records.filter((row) => row.status === "requires_review").length,
  };
  return <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6"><div className="max-w-7xl mx-auto space-y-6"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Know Your Business</h1><p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your business verification records</p></div><Button asChild className="bg-violet-600 hover:bg-violet-700 text-white"><Link href="/kyb/new"><FileCheck className="mr-2 h-4 w-4" />New Verification</Link></Button></div>{error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"><StatCard label="Total" value={stats.total} icon={FileCheck} tone="slate" /><StatCard label="Approved" value={stats.approved} icon={CheckCircle} tone="green" /><StatCard label="Processing" value={stats.pending + stats.processing} icon={Building2} tone="violet" /><StatCard label="Review" value={stats.requires_review} icon={ShieldAlert} tone="orange" /><StatCard label="Declined" value={stats.declined} icon={CheckCircle} tone="red" /></div><div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6"><KYBTable records={records} /></div></div></div>;
}
