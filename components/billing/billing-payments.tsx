"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { CreditCard, FileText, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { formatMoney } from "@/backend/convex/lib/pricing";

// Top-ups and invoices on the Billing page (backend/convex/billing.ts):
// pay online with Paystack (card or mobile money), or by bank transfer /
// M-Pesa paybill using the details on the invoice; save a card for
// automatic top-ups.

type Invoice = {
  _id: string;
  number: string;
  kind: "top_up" | "plan" | "other";
  status: "issued" | "paid" | "void";
  currency: "USD" | "KES";
  total: number;
  credits: number;
  issuedAt: number;
  dueAt: number;
  paidAt: number | null;
  paymentMethod: string | null;
  automatic: boolean;
};

type Overview = {
  currency: "USD" | "KES";
  plan: string;
  paystackEnabled: boolean;
  canPay: boolean;
  limits: { min: number; max: number };
  presets: number[];
  invoices: Invoice[];
  options: {
    billingEmail: string | null;
    taxPin: string | null;
    card: { last4: string | null; brand: string | null; expMonth: string | null; expYear: string | null; savedAt: number } | null;
    autoTopUp: { enabled: boolean; amount: number; thresholdCredits: number } | null;
    lastAutoTopUpAt: number | null;
  };
};

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

const STATUS_STYLE: Record<Invoice["status"], string> = {
  issued: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  void: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
const STATUS_LABEL: Record<Invoice["status"], string> = { issued: "Unpaid", paid: "Paid", void: "Cancelled" };

// Back from Paystack's checkout: confirm the payment.
function usePaymentReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const confirm = useAction(anyApi.billing.confirmPayment);
  const done = useRef(false);
  const reference = params.get("payment") ?? params.get("reference");
  useEffect(() => {
    if (!reference || done.current) return;
    done.current = true;
    void confirm({ reference })
      .then((result: { status: string; invoiceNumber: string | null }) => {
        if (result.status === "paid" || result.status === "already") toast.success(`Payment received${result.invoiceNumber ? ` for ${result.invoiceNumber}` : ""}. Credits added.`);
        else if (result.status === "pending") toast.message("Payment is still processing. Credits are added as soon as Paystack confirms it.");
        else toast.error("The payment didn't go through.");
      })
      .catch((error: unknown) => toast.error(getErrorMessage(error, "Couldn't confirm the payment.")))
      .finally(() => router.replace("/billing"));
  }, [reference, confirm, router]);
}

export function BillingPayments({ clientId }: { clientId: string }) {
  usePaymentReturn();
  const data = useAuthedQuery(anyApi.billing.overview, { clientId }) as Overview | null | undefined;
  const startTopUp = useAction(anyApi.billing.startTopUp);
  const payInvoice = useAction(anyApi.billing.payInvoice);
  const [amount, setAmount] = useState<string>("");
  const [saveCard, setSaveCard] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return null;
  const go = async (key: string, run: () => Promise<{ url: string }>) => {
    setBusy(key);
    try {
      const { url } = await run();
      window.location.assign(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't start the payment."));
      setBusy(null);
    }
  };
  const value = Number(amount);
  const amountOk = Number.isFinite(value) && value >= data.limits.min && value <= data.limits.max;
  const unpaid = data.invoices.filter((invoice) => invoice.status === "issued");

  return (
    <>
      {data.canPay ? (
        <Card className="p-6 space-y-4">
          <div>
            <p className="text-sm font-medium">Top up credits</p>
            <p className="text-xs text-muted-foreground">
              {data.paystackEnabled
                ? "Pay by card or mobile money on Paystack. Credits are added as soon as the payment is confirmed, and you get a paid invoice."
                : "Online payment isn't set up yet. Ask DeepTrack for an invoice and pay by bank transfer or M-Pesa."}
            </p>
          </div>
          {data.paystackEnabled ? (
            <>
              <div className="flex flex-wrap gap-2">
                {data.presets.map((preset) => (
                  <Button key={preset} type="button" size="sm" variant={value === preset ? "default" : "outline"} onClick={() => setAmount(String(preset))}>
                    {formatMoney(preset, data.currency)}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="block text-xs text-muted-foreground">Amount ({data.currency})</span>
                  <input
                    type="number"
                    min={data.limits.min}
                    max={data.limits.max}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={`${inputClass} w-44`}
                    placeholder={String(data.presets[0])}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={saveCard} onChange={(event) => setSaveCard(event.target.checked)} />
                  Save the card for automatic top-ups
                </label>
                <Button disabled={!amountOk || busy !== null} onClick={() => void go("topup", () => startTopUp({ clientId, amount: value, saveCard }))}>
                  {busy === "topup" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                  Pay {amountOk ? formatMoney(value, data.currency) : ""}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {data.currency} {data.limits.min.toLocaleString("en-US")}–{data.limits.max.toLocaleString("en-US")}. Taxes, if any, are added on the invoice.
              </p>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Invoices</p>
          {unpaid.length ? <span className="text-xs text-amber-700 dark:text-amber-300">{unpaid.length} unpaid</span> : null}
        </div>
        {data.invoices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {data.invoices.map((invoice) => (
              <li key={invoice._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/billing/invoices/${invoice._id}`} className="font-mono text-xs font-medium hover:underline">
                    {invoice.number}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    <ClientDate value={invoice.issuedAt} format="PP" /> · {invoice.kind === "top_up" ? "Top-up" : invoice.kind === "plan" ? "Plan" : "Charge"}
                    {invoice.credits ? ` · ${invoice.credits.toLocaleString("en-US")} credits` : ""}
                    {invoice.automatic ? " · automatic" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatMoney(invoice.total, invoice.currency)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[invoice.status]}`}>{STATUS_LABEL[invoice.status]}</span>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/billing/invoices/${invoice._id}`}>
                      <FileText className="mr-1 h-4 w-4" /> View
                    </Link>
                  </Button>
                  {invoice.status === "issued" && data.canPay && data.paystackEnabled ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void go(invoice._id, () => payInvoice({ invoiceId: invoice._id, saveCard }))}>
                      {busy === invoice._id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Pay
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.canPay ? <BillingOptions clientId={clientId} data={data} /> : null}
    </>
  );
}

function BillingOptions({ clientId, data }: { clientId: string; data: Overview }) {
  const save = useMutation(anyApi.billing.saveOptions);
  const removeCard = useMutation(anyApi.billing.removeCard);
  const [billingEmail, setBillingEmail] = useState(data.options.billingEmail ?? "");
  const [taxPin, setTaxPin] = useState(data.options.taxPin ?? "");
  const [auto, setAuto] = useState(data.options.autoTopUp ?? { enabled: false, amount: data.presets[1] ?? data.limits.min, thresholdCredits: 100 });
  const [saving, setSaving] = useState(false);
  const card = data.options.card;

  const submit = async () => {
    setSaving(true);
    try {
      await save({ clientId, billingEmail, taxPin, autoTopUp: { enabled: auto.enabled && Boolean(card), amount: Number(auto.amount), thresholdCredits: Number(auto.thresholdCredits) } });
      toast.success("Billing settings saved");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save the billing settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <p className="text-sm font-medium">Billing settings</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Billing email (receipts and payment links)</span>
          <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} className={inputClass} placeholder="finance@yourbank.co.ke" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">KRA PIN (shown on invoices)</span>
          <input value={taxPin} onChange={(event) => setTaxPin(event.target.value)} className={inputClass} placeholder="P051234567X" />
        </label>
      </div>

      <div className="rounded-lg border p-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium">
          <Zap className="h-4 w-4" /> Automatic top-up
        </p>
        {card ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              Saved card: {card.brand ?? "card"} •••• {card.last4 ?? "????"}
              {card.expMonth && card.expYear ? `, expires ${card.expMonth}/${card.expYear}` : ""}.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  if (!window.confirm("Remove the saved card? Automatic top-up is turned off.")) return;
                  void removeCard({ clientId }).then(
                    () => toast.success("Card removed"),
                    (error: unknown) => toast.error(getErrorMessage(error, "Couldn't remove the card.")),
                  );
                }}
              >
                Remove
              </button>
            </p>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={auto.enabled} onChange={(event) => setAuto({ ...auto, enabled: event.target.checked })} />
              Charge the card when the balance falls to
              <input
                type="number"
                min={0}
                value={auto.thresholdCredits}
                onChange={(event) => setAuto({ ...auto, thresholdCredits: Number(event.target.value) })}
                className={`${inputClass} w-28`}
              />
              credits, for
              <input type="number" min={data.limits.min} max={data.limits.max} value={auto.amount} onChange={(event) => setAuto({ ...auto, amount: Number(event.target.value) })} className={`${inputClass} w-32`} />
              {data.currency}
            </label>
            {data.options.lastAutoTopUpAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Last automatic top-up: <ClientDate value={data.options.lastAutoTopUpAt} format="PPp" />. At most one every 12 hours.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">At most one every 12 hours. If the card is declined, the Admins are notified.</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Pay a top-up by card with &ldquo;Save the card&rdquo; ticked, then turn this on. Mobile money payments can&apos;t be charged automatically.</p>
        )}
      </div>
      <Button onClick={() => void submit()} disabled={saving}>
        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Save billing settings
      </Button>
    </Card>
  );
}
