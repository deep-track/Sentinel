import { InvoiceDocument } from "@/components/billing/invoice-document";

export const dynamic = "force-dynamic";

// A printable invoice (save as PDF from the browser's print dialog).
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-full bg-slate-50 px-4 py-8 dark:bg-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <InvoiceDocument invoiceId={id} />
      </div>
    </div>
  );
}
