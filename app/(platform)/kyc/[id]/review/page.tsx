import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { KYCReviewActions } from "./kyc-review-actions";

export default async function KYCReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getAuthenticatedConvexClient();
  if (!client) notFound();
  let record: any = null;
  try {
    record = await client.query(anyApi.verifications.get, { id: id as any });
  } catch (error) {
    console.error("[kyc.review] Convex query failed", error);
  }
  if (!record || record.type !== "idp") notFound();
  const input = record.input && typeof record.input === "object" ? record.input : {};
  return <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4"><div className="max-w-2xl mx-auto"><Link href={`/kyc/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-8"><ChevronLeft className="h-4 w-4" />Back to Record</Link><div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6"><div><p className="text-xs uppercase tracking-wide text-slate-500">Protected reviewer workspace</p><h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">Review identity verification</h1><p className="font-mono text-sm text-slate-500 mt-1">{record.reference}</p></div><div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-4"><p className="text-sm text-slate-500">Subject</p><p className="font-medium text-slate-900 dark:text-white">{input.subjectName ?? input.name ?? "Unnamed subject"}</p><p className="text-sm text-slate-500 mt-2">Current status: {record.verdict ?? record.status}</p></div><KYCReviewActions id={id} /></div></div></div>;
}