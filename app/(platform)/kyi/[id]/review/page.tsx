import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// NOTE: getKYIRecord previously came from actions/kyi.ts, which was
// removed as part of the Convex backend migration. There is no public
// Convex query yet for fetching a single KYI record by ID, so this page
// cannot load real data to review. Showing an honest unavailable state
// instead of faking a record.

interface KYIReviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function KYIReviewPage({ params }: KYIReviewPageProps) {
  const { id } = await params;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link
          href={`/kyi/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 mb-8"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Record
        </Link>
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
          <p className="text-amber-700 dark:text-amber-400 font-medium">
            Record review is temporarily unavailable while the backend
            migrates to Convex.
          </p>
        </div>
      </div>
    </div>
  );
}