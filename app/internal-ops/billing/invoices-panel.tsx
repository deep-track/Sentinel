"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Badge, Panel, PanelHeader } from "@/components/sentinel/ui";
import { formatMoney } from "@/backend/convex/lib/pricing";

// Back Office invoices (billing.ts): open invoices across clients or one
// client's, issuing plan / other invoices, marking bank transfer and M-Pesa
// payments, cancelling, and the details printed on every invoice.

type InvoiceRow = {
  _id: string;
  number: string;
  kind: "top_up" | "plan" | "other";
  status: "issued" | "paid" | "void";
  currency: "USD" | "KES";
  total: number;
  credits: number;
  issuedAt: number;
  dueAt: number;
  paymentMethod: string | null;
  clientId: string;
  clientName: string;
  overdue: boolean;
};

type Seller = { name?: string; address?: string; kraPin?: string; email?: string; vatRatePct?: number; paymentInstructions?: string } | null;
type Data = { invoices: InvoiceRow[]; seller: Seller; plans: Array<{ plan: string; label: string; USD: number; KES: number }>; paystackEnabled: boolean };

const inputClass = "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text disabled:opacity-60";
const buttonClass = "rounded bg-sentinel-blue px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-60";

export function InvoicesPanel({ clients, canWrite }: { clients: Array<{ _id: string; name: string }>; canWrite: boolean }) {
  const [clientId, setClientId] = useState("");
  const data = useAuthedQuery(anyApi.billing.listForBackOffice, clientId ? { clientId } : {}) as Data | undefined;
  const markPaid = useMutation(anyApi.billing.markPaid);
  const voidInvoice = useMutation(anyApi.billing.voidInvoice);

  const act = async (run: () => Promise<unknown>, done: string, fallback: string) => {
    try {
      await run();
      toast.success(done);
    } catch (error) {
      toast.error(getErrorMessage(error, fallback));
    }
  };

  return (
    <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
      <Panel>
        <PanelHeader
          icon={FileText}
          title={clientId ? "Invoices" : "Unpaid invoices"}
          hint={data?.paystackEnabled ? "Paystack on" : "Paystack not configured"}
          action={
            <select className="rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px]" value={clientId} onChange={(event) => setClientId(event.target.value)} aria-label="Client">
              <option value="">All clients (unpaid)</option>
              {clients.map((client) => (
                <option key={client._id} value={client._id}>
                  {client.name}
                </option>
              ))}
            </select>
          }
        />
        <div className="divide-y divide-sentinel-line text-[12px]">
          {!data ? (
            <p className="p-3.5 text-sentinel-subtle">Loading…</p>
          ) : data.invoices.length === 0 ? (
            <p className="p-3.5 text-sentinel-subtle">No invoices.</p>
          ) : (
            data.invoices.map((invoice) => (
              <div key={invoice._id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2">
                <span>
                  <Link href={`/internal-ops/billing/invoices/${invoice._id}`} className="font-mono text-[11px] hover:underline">
                    {invoice.number}
                  </Link>{" "}
                  <span className="text-sentinel-muted">
                    {invoice.clientName} · <ClientDate value={invoice.issuedAt} format="MMM d" /> · {invoice.credits.toLocaleString("en-US")} credits
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatMoney(invoice.total, invoice.currency)}</span>
                  <Badge tone={invoice.status === "paid" ? "green" : invoice.status === "void" ? "neutral" : invoice.overdue ? "red" : "amber"}>
                    {invoice.status === "paid" ? `Paid${invoice.paymentMethod ? ` · ${invoice.paymentMethod.replace("_", " ")}` : ""}` : invoice.status === "void" ? "Cancelled" : invoice.overdue ? "Overdue" : "Unpaid"}
                  </Badge>
                  {canWrite && invoice.status === "issued" ? (
                    <>
                      <button
                        type="button"
                        className="text-sentinel-blue hover:underline"
                        onClick={() => {
                          const method = window.prompt("Paid by: bank_transfer, mpesa or other", "mpesa");
                          if (!method) return;
                          if (!["bank_transfer", "mpesa", "other"].includes(method)) return void toast.error("Enter bank_transfer, mpesa or other.");
                          const reference = window.prompt("Transaction reference (bank or M-Pesa code)");
                          if (!reference) return;
                          void act(() => markPaid({ invoiceId: invoice._id, method, reference }), `${invoice.number} marked paid; credits added.`, "Couldn't mark the invoice paid.");
                        }}
                      >
                        Mark paid
                      </button>
                      <button
                        type="button"
                        className="text-sentinel-muted hover:underline"
                        onClick={() => {
                          const reason = window.prompt(`Cancel ${invoice.number}? Reason:`);
                          if (!reason) return;
                          void act(() => voidInvoice({ invoiceId: invoice._id, reason }), `${invoice.number} cancelled.`, "Couldn't cancel the invoice.");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>
      <div className="flex flex-col gap-3.5">
        {canWrite ? <IssueInvoice clients={clients} plans={data?.plans ?? []} /> : null}
        <SellerDetails seller={data?.seller ?? null} canWrite={canWrite} />
      </div>
    </div>
  );
}

function IssueInvoice({ clients, plans }: { clients: Array<{ _id: string; name: string }>; plans: Data["plans"] }) {
  const issueInvoice = useMutation(anyApi.billing.issueInvoice);
  const [form, setForm] = useState({ clientId: "", kind: "plan" as "plan" | "other", plan: "starter", description: "", amount: "", credits: "", dueDays: "14" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const result = (await issueInvoice({
        clientId: form.clientId,
        kind: form.kind,
        ...(form.kind === "plan" ? { plan: form.plan } : { description: form.description, amount: Number(form.amount), credits: Number(form.credits || 0) }),
        dueDays: Number(form.dueDays || 14),
      })) as { number: string };
      toast.success(`Invoice ${result.number} issued.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't issue the invoice."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel>
      <PanelHeader icon={FileText} title="Issue an invoice" hint="In the client's billing currency" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <select className={inputClass} value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} aria-label="Client">
          <option value="">Choose a client…</option>
          {clients.map((client) => (
            <option key={client._id} value={client._id}>
              {client.name}
            </option>
          ))}
        </select>
        <select className={inputClass} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as "plan" | "other" })} aria-label="Kind">
          <option value="plan">Plan prepayment</option>
          <option value="other">Other charge</option>
        </select>
        {form.kind === "plan" ? (
          <select className={inputClass} value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} aria-label="Plan">
            {plans.map((plan) => (
              <option key={plan.plan} value={plan.plan}>
                {plan.label} (USD {plan.USD.toLocaleString("en-US")} / KES {plan.KES.toLocaleString("en-US")})
              </option>
            ))}
          </select>
        ) : (
          <>
            <input className={inputClass} placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} inputMode="decimal" placeholder="Amount" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
              <input className={inputClass} inputMode="numeric" placeholder="Credits to add" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} />
            </div>
          </>
        )}
        <label className="block">
          <span className="text-sentinel-subtle">Due in (days)</span>
          <input className={inputClass} inputMode="numeric" value={form.dueDays} onChange={(event) => setForm({ ...form, dueDays: event.target.value })} />
        </label>
        <button type="button" className={`${buttonClass} w-full`} disabled={saving || !form.clientId} onClick={() => void submit()}>
          Issue invoice
        </button>
      </div>
    </Panel>
  );
}

function SellerDetails({ seller, canWrite }: { seller: Seller; canWrite: boolean }) {
  const saveSeller = useMutation(anyApi.billing.saveSeller);
  const initial = () => ({
    name: seller?.name ?? "DeepTrack",
    address: seller?.address ?? "",
    kraPin: seller?.kraPin ?? "",
    email: seller?.email ?? "",
    vatRatePct: String(seller?.vatRatePct ?? 0),
    paymentInstructions: seller?.paymentInstructions ?? "",
  });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [seller]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await saveSeller({ ...form, vatRatePct: Number(form.vatRatePct || 0) });
      toast.success("Invoice details saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save the invoice details."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel>
      <PanelHeader icon={FileText} title="On every invoice" hint="DeepTrack's details" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <input className={inputClass} disabled={!canWrite} placeholder="Company name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <textarea className={inputClass} disabled={!canWrite} rows={2} placeholder="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} disabled={!canWrite} placeholder="KRA PIN" value={form.kraPin} onChange={(event) => setForm({ ...form, kraPin: event.target.value })} />
          <input className={inputClass} disabled={!canWrite} inputMode="decimal" placeholder="VAT %" value={form.vatRatePct} onChange={(event) => setForm({ ...form, vatRatePct: event.target.value })} />
        </div>
        <input className={inputClass} disabled={!canWrite} placeholder="Billing email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <label className="block">
          <span className="text-sentinel-subtle">How to pay (bank account, M-Pesa paybill and account number)</span>
          <textarea
            className={inputClass}
            disabled={!canWrite}
            rows={5}
            placeholder={"Bank: …  Account: …  Branch: …\nM-Pesa: Paybill …, Account …"}
            value={form.paymentInstructions}
            onChange={(event) => setForm({ ...form, paymentInstructions: event.target.value })}
          />
        </label>
        <p className="text-[10px] text-sentinel-subtle">VAT 0% prints an invoice without VAT. Set your VAT rate (16% in Kenya) only if DeepTrack is VAT-registered.</p>
        {canWrite ? (
          <button type="button" className={`${buttonClass} w-full`} disabled={saving} onClick={() => void submit()}>
            Save
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
