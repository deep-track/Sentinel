"use client";

import Link from "next/link";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { ChevronLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { formatMoney } from "@/backend/convex/lib/pricing";
import { downloadInvoicePdf } from "@/components/billing/invoice-pdf";

// An invoice laid out for printing / saving as PDF (billing.invoice).

type Party = { name: string; address?: string; kraPin?: string; email?: string; paymentInstructions?: string };
type Invoice = {
  _id: string;
  number: string;
  status: "issued" | "paid" | "void";
  currency: "USD" | "KES";
  lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  vatRatePct: number;
  vat: number;
  total: number;
  credits: number;
  buyer: Party;
  seller: Party;
  issuedAt: number;
  dueAt: number;
  paidAt: number | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  voidedAt: number | null;
  notes: string | null;
};

const METHOD_LABELS: Record<string, string> = { paystack: "Paystack", bank_transfer: "Bank transfer", mpesa: "M-Pesa", other: "Other" };

function PartyBlock({ label, party }: { label: string; party: Party }) {
  return (
    <div className="text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold">{party.name}</p>
      {party.address ? <p className="whitespace-pre-line text-slate-600 dark:text-slate-300">{party.address}</p> : null}
      {party.kraPin ? <p className="text-slate-600 dark:text-slate-300">KRA PIN {party.kraPin}</p> : null}
      {party.email ? <p className="text-slate-600 dark:text-slate-300">{party.email}</p> : null}
    </div>
  );
}

export function InvoiceDocument({ invoiceId, backHref = "/billing" }: { invoiceId: string; backHref?: string }) {
  const invoice = useAuthedQuery(anyApi.billing.invoice, { invoiceId }) as Invoice | null | undefined;
  if (invoice === undefined) return <Skeleton className="h-96 w-full" />;
  if (invoice === null) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">This invoice doesn&apos;t exist, or you don&apos;t have access to it.</p>;
  const money = (value: number) => formatMoney(value, invoice.currency);

  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" /> Billing
        </Link>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void downloadInvoicePdf(invoice).catch(() => toast.error("The PDF couldn't be created. Use Print instead."))}>
            <Download className="mr-1.5 h-4 w-4" /> Download {invoice.status === "paid" ? "receipt" : "invoice"} (PDF)
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
      </div>
      <article className="relative rounded-2xl border bg-white p-8 text-slate-900 dark:bg-slate-900 dark:text-white print:border-0 print:p-0">
        {invoice.status !== "issued" ? (
          <span
            className={`absolute right-8 top-8 rotate-6 rounded border-2 px-3 py-1 text-lg font-bold uppercase ${invoice.status === "paid" ? "border-emerald-600 text-emerald-600" : "border-slate-400 text-slate-400"}`}
          >
            {invoice.status === "paid" ? "Paid" : "Cancelled"}
          </span>
        ) : null}
        <header>
          <h1 className="text-2xl font-bold">{invoice.vatRatePct > 0 ? "Tax invoice" : "Invoice"}</h1>
          <p className="mt-1 font-mono text-sm">{invoice.number}</p>
          <p className="mt-1 text-sm text-slate-500">
            Issued <ClientDate value={invoice.issuedAt} format="PP" /> · Due <ClientDate value={invoice.dueAt} format="PP" />
          </p>
        </header>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <PartyBlock label="From" party={invoice.seller} />
          <PartyBlock label="Bill to" party={invoice.buyer} />
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b">
                <td className="py-2 pr-2">{line.description}</td>
                <td className="py-2 text-right">{line.quantity}</td>
                <td className="py-2 text-right">{money(line.unitPrice)}</td>
                <td className="py-2 text-right">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-slate-500">
                Subtotal
              </td>
              <td className="pt-3 text-right">{money(invoice.subtotal)}</td>
            </tr>
            {invoice.vatRatePct > 0 ? (
              <tr>
                <td colSpan={3} className="text-right text-slate-500">
                  VAT {invoice.vatRatePct}%
                </td>
                <td className="text-right">{money(invoice.vat)}</td>
              </tr>
            ) : null}
            <tr className="text-base font-semibold">
              <td colSpan={3} className="pt-2 text-right">
                Total ({invoice.currency})
              </td>
              <td className="pt-2 text-right">{money(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.credits ? <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{invoice.credits.toLocaleString("en-US")} Sentinel credits are added when this invoice is paid.</p> : null}

        {invoice.status === "paid" ? (
          <p className="mt-4 text-sm">
            Paid <ClientDate value={invoice.paidAt} format="PP" /> by {METHOD_LABELS[invoice.paymentMethod ?? "other"] ?? invoice.paymentMethod}
            {invoice.paymentReference ? ` (ref. ${invoice.paymentReference})` : ""}.
          </p>
        ) : invoice.status === "issued" ? (
          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800">
            <p className="font-medium">How to pay</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">Online by card or mobile money from the Billing page in Sentinel.</p>
            {invoice.seller.paymentInstructions ? <p className="mt-2 whitespace-pre-line text-slate-600 dark:text-slate-300">{invoice.seller.paymentInstructions}</p> : null}
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Use <span className="font-mono font-medium">{invoice.number}</span> as the payment reference.
            </p>
          </div>
        ) : null}
        {invoice.notes ? <p className="mt-4 whitespace-pre-line text-xs text-slate-500">{invoice.notes}</p> : null}
      </article>
    </>
  );
}
