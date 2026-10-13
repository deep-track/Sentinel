import { DocumentReport } from "./document-report";

export const dynamic = "force-dynamic";

// Detailed, downloadable IDP document report (PDF via print, JSON).
export default async function DocumentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-full bg-slate-50 px-4 py-8 dark:bg-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <DocumentReport verificationId={id} />
      </div>
    </div>
  );
}
