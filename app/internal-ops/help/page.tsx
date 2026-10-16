import Link from "next/link";
import { HelpIndex } from "@/components/help/help-index";
import { INTERNAL_MANUALS, MANUALS, listChapters } from "@/backend/lib/help";

// Manual D, the Back Office runbook. Access is enforced by
// app/internal-ops/layout.tsx (internal roles only).
export default function OpsHelpPage() {
  const chapters = listChapters(INTERNAL_MANUALS);
  const manuals = INTERNAL_MANUALS.map((id) => ({ id, ...MANUALS[id] }));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Back Office runbook</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          How DeepTrack staff run the Back Office. Internal only. The client manuals are in{" "}
          <Link href="/help" className="text-sky-700 underline underline-offset-2 dark:text-sky-400">
            Help
          </Link>
          .
        </p>
      </div>
      <HelpIndex manuals={manuals} chapters={chapters} basePath="/internal-ops/help" />
    </div>
  );
}
