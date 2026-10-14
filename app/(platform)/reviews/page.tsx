export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ReviewQueue } from "./review-queue";

// The team's review queue for the selected organization.
export default async function ReviewsPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reviews</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Cases from {scope.clientName}&apos;s checks that need a person: sanctions and PEP hits, adverse media, document fraud and other flags.
        </p>
      </div>
      {scope.role === "developer" ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Developers don&apos;t review cases. Ask an Analyst, Reviewer or Admin.</p>
      ) : (
        <ReviewQueue clientId={scope.clientId} />
      )}
    </div>
  );
}
