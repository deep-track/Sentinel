import { notFound } from "next/navigation";
import Link from "next/link";
import { getKYIRecord, refreshKYIFromShufti } from "@/actions/kyi";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, RefreshCw, TrendingUp, ExternalLink, ClipboardCheck, Scan } from "lucide-react";
import { format } from "date-fns";

interface KYIDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function KYIDetailPage({ params }: KYIDetailPageProps) {
  const { id } = await params;
  const result = await getKYIRecord(id);

  if (!result.success || !result.data) notFound();

  const record = result.data;
  const extracted = record.extractedData;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/kyi" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
            <ChevronLeft className="h-4 w-4" /> Back to KYI
          </Link>

          <div className="flex items-center gap-3">
            <form action={async () => {"use server"; await refreshKYIFromShufti(record.id, record.reference);}}>
              <Button variant="outline" size="sm" type="submit">
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
              </Button>
            </form>
            {(record.status === "processing" || record.status === "requires_review") && (
              <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
                <Link href={`/kyi/${id}/review`}>
                  <ClipboardCheck className="mr-2 h-4 w-4" /> Review
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <TrendingUp className="h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  {[extracted?.name?.first_name, extracted?.name?.last_name].filter(Boolean).join(" ") || record.userName}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">
                  {record.investorType?.replace(/_/g, " ")} • {record.accreditationStatus}
                </p>
                <div className="mt-2"><KYIStatusBadge status={record.status} /></div>
              </div>
            </div>
            <code className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{record.reference}</code>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
                <Scan className="h-4 w-4 text-slate-400" /> Extracted Investor Data
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <p><strong>Name:</strong> {[extracted?.name?.first_name, extracted?.name?.middle_name, extracted?.name?.last_name].filter(Boolean).join(" ") || "—"}</p>
                <p><strong>DOB:</strong> {extracted?.dob ?? "—"}</p>
                <p><strong>Document #:</strong> {extracted?.document_number ?? "—"}</p>
                <p><strong>Nationality:</strong> {extracted?.nationality ?? "—"}</p>
                <p><strong>Gender:</strong> {extracted?.gender ?? "—"}</p>
                <p><strong>Country:</strong> {extracted?.country ?? "—"}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4">Investor Submission</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <p><strong>Investor type:</strong> {record.investorType?.replace(/_/g, " ") ?? "—"}</p>
                <p><strong>Accreditation:</strong> {record.accreditationStatus ?? "—"}</p>
                <p><strong>Investment:</strong> {record.investmentAmount ?? "—"} {record.investmentCurrency ?? ""}</p>
                <p><strong>Source of funds:</strong> {record.sourceOfFunds?.replace(/_/g, " ") ?? "—"}</p>
                <p><strong>PEP:</strong> {record.isPEP ? "Yes" : "No"}</p>
                <p><strong>ID Type:</strong> {record.governmentIdType?.replace(/_/g, " ") ?? "—"}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4">Uploaded Documents</h2>
              <div className="space-y-2 text-sm">
                <p>{record.governmentIdUrl ? "✅" : "⊘"} Government ID</p>
                <p>{record.selfieUrl ? "✅" : "⊘"} Selfie</p>
                <p>{record.bankStatementUrl ? "✅" : "⊘"} Bank Statement</p>
                <p>{record.proofOfAddressUrl ? "✅" : "⊘"} Proof of Address</p>
                <p>{record.proofOfNetWorthUrl ? "✅" : "⊘"} Proof of Net Worth</p>
                <p>{record.accreditationLetterUrl ? "✅" : "⊘"} Accreditation Letter</p>
                <p>{record.sourceOfFundsDocUrl ? "✅" : "⊘"} Source of Funds Doc</p>
                <p>{record.corporateDocUrl ? "✅" : "⊘"} Corporate Doc</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider">Verification Details</h2>
              <p className="text-sm"><strong>Event:</strong> {record.shuftiEventType ?? "—"}</p>
              <p className="text-sm"><strong>Submitted:</strong> {record.submittedAt ? format(new Date(record.submittedAt), "MMM d, yyyy HH:mm") : "—"}</p>
              {record.reviewedAt && <p className="text-sm"><strong>Reviewed:</strong> {format(new Date(record.reviewedAt), "MMM d, yyyy HH:mm")}</p>}
              {record.riskScore !== undefined && record.riskScore !== null && <p className="text-sm"><strong>Risk Score:</strong> {record.riskScore}</p>}
              {record.shuftiVerificationUrl && (
                <a href={record.shuftiVerificationUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-violet-600 hover:underline">
                  View Verification Details <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
