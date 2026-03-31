import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { KYIWizard } from "@/modules/kyi/kyi-wizard";

interface NewKYIPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function NewKYIPage({ searchParams }: NewKYIPageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/kyi"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 mb-8 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back to KYI
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Investor Verification</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm max-w-xl">
            Complete investor due diligence including identity, accreditation, and source of funds verification.
          </p>
        </div>

        <KYIWizard />
      </div>
    </div>
  );
}
