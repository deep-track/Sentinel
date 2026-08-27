import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

interface KYCDetailPageProps {
  params: Promise<{ id: string }>;
}

function displayStatus(row: any) {
  if (row.verdict === "pass") return "Approved";
  if (row.verdict === "reject") return "Declined";
  if (row.verdict === "review") return "Needs review";
  return row.status === "processing" ? "Processing" : "Queued";
}

export default async function KYCDetailPage({ params }: KYCDetailPageProps) {
  const { id } = await params;
  const client = await getAuthenticatedConvexClient();
  if (!client) notFound();
  let record: any = null;
  try {
    record = await client.query(anyApi.verifications.get, { id: id as any });
  } catch (error) {
    console.error("[kyc.detail] Convex query failed", error);
  }
  if (!record || record.type !== "idp") notFound();
  const input = record.input && typeof record.input === "object" ? record.input : {};
  const result = record.result && typeof record.result === "object" ? record.result : {};
  return <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4"><div className="max-w-3xl mx-auto"><Link href="/kyc" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-8"><ChevronLeft className="h-4 w-4" />Back to KYC</Link><div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-slate-500">Identity verification</p><h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{input.subjectName ?? input.name ?? "Unnamed subject"}</h1><p className="font-mono text-sm text-slate-500 mt-1">{record.reference}</p></div><span className="rounded-full bg-violet-100 text-violet-700 px-3 py-1 text-sm font-medium">{displayStatus(record)}</span></div><dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[["Document type", input.documentType ?? "Identity document"],["Submitted", new Date(record.createdAt).toLocaleString()],["Updated", new Date(record.updatedAt).toLocaleString()],["Confidence", record.confidence == null ? "—" : `${Math.round(record.confidence * 100)}%`]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-800 p-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{value}</dd></div>)}</dl>{record.failureReason ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{record.failureReason}</div> : null}<div><h2 className="font-semibold text-slate-900 dark:text-white">Verification result</h2><pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-200">{JSON.stringify(result, null, 2)}</pre></div>{record.verdict === "review" ? <Link href={`/kyc/${id}/review`} className="inline-flex rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Open review</Link> : null}</div></div></div>;
}
