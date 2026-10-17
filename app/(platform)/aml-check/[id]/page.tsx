import { AmlReport } from "./aml-report";
import { DisputeButton } from "@/components/disputes/dispute-button";

export const dynamic = "force-dynamic";

// Detailed, downloadable AML screening report (PDF via print, CSV, JSON).
export default async function AmlReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-full bg-slate-50 px-4 py-8 dark:bg-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex justify-end print:hidden">
          <DisputeButton verificationId={id} />
        </div>
        <AmlReport verificationId={id} />
      </div>
    </div>
  );
}
