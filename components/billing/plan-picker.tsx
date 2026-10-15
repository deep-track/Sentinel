"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Check, CreditCard, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { formatMoney } from "@/backend/convex/lib/pricing";

// Choose a plan on the Billing page: pay the annual prepayment on Paystack,
// or get the invoice to pay by bank transfer / M-Pesa. Once it's paid the
// organization moves to the plan and gets its credits (billing.ts).

type PlanOption = {
  plan: "starter" | "growth" | "business" | "enterprise";
  label: string;
  price: number;
  credits: number;
  bonusPct: number;
  prices: Array<{ service: string; label: string; credits: number; amount: number }>;
  pendingInvoiceId: string | null;
};
type Overview = { currency: "USD" | "KES"; plan: string; paystackEnabled: boolean; canPay: boolean; plans: PlanOption[] };

const HIGHLIGHT: PlanOption["plan"] = "growth";
const SHOWN_SERVICES = ["kyc_identity", "aml", "identity_document", "kyb"];

export function PlanPicker({ clientId }: { clientId: string }) {
  const data = useAuthedQuery(anyApi.billing.overview, { clientId }) as Overview | null | undefined;
  const startPlanPurchase = useAction(anyApi.billing.startPlanPurchase);
  const requestPlanInvoice = useMutation(anyApi.billing.requestPlanInvoice);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.plans) return null;

  const pay = async (plan: PlanOption) => {
    setBusy(`pay-${plan.plan}`);
    try {
      const { url } = (await startPlanPurchase({ clientId, plan: plan.plan, saveCard: true })) as { url: string };
      window.location.assign(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't start the payment."));
      setBusy(null);
    }
  };
  const invoice = async (plan: PlanOption) => {
    setBusy(`invoice-${plan.plan}`);
    try {
      const { invoiceId, number } = (await requestPlanInvoice({ clientId, plan: plan.plan })) as { invoiceId: string; number: string };
      toast.success(`Invoice ${number} is ready. Pay it by bank transfer or M-Pesa using the details on it.`);
      router.push(`/billing/invoices/${invoiceId}`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't create the invoice."));
      setBusy(null);
    }
  };

  return (
    <Card className="p-6">
      <p className="text-sm font-medium">Plans</p>
      <p className="text-xs text-muted-foreground">
        Annual prepayment, billed in {data.currency}. Bigger plans cost less per check. Your plan changes and the credits are added as soon as the payment is confirmed; unused credits stay on your balance.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((option) => {
          const current = data.plan === option.plan;
          return (
            <div key={option.plan} className={`flex flex-col rounded-xl border p-4 ${option.plan === HIGHLIGHT ? "border-primary shadow-sm" : ""} ${current ? "bg-primary/5" : ""}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{option.label}</p>
                {current ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Current</span>
                ) : option.plan === HIGHLIGHT ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">Popular</span>
                ) : null}
              </div>
              <p className="mt-2 text-2xl font-bold">{formatMoney(option.price, data.currency)}</p>
              <p className="text-xs text-muted-foreground">
                per year · {option.credits.toLocaleString("en-US")} credits{option.bonusPct ? ` (incl. ${option.bonusPct}% bonus)` : ""}
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-xs">
                {option.prices
                  .filter((row) => SHOWN_SERVICES.includes(row.service))
                  .map((row) => (
                    <li key={row.service} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        {row.label}: <span className="font-medium">{formatMoney(row.amount, data.currency)}</span>
                      </span>
                    </li>
                  ))}
              </ul>
              {data.canPay ? (
                <div className="mt-4 space-y-2">
                  {data.paystackEnabled ? (
                    <Button className="w-full" size="sm" variant={option.plan === HIGHLIGHT ? "default" : "outline"} disabled={busy !== null} onClick={() => void pay(option)}>
                      {busy === `pay-${option.plan}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                      {current ? "Renew" : "Choose"} and pay
                    </Button>
                  ) : null}
                  <Button
                    className="w-full"
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => (option.pendingInvoiceId ? router.push(`/billing/invoices/${option.pendingInvoiceId}`) : void invoice(option))}
                  >
                    {busy === `invoice-${option.plan}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
                    {option.pendingInvoiceId ? "Open the unpaid invoice" : "Pay by bank / M-Pesa"}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!data.canPay ? <p className="mt-3 text-xs text-muted-foreground">Only Admins can change the plan.</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Need more volume, a custom contract or invoicing terms? <a href="mailto:sales@deeptrack.io" className="underline">Talk to sales</a>.
      </p>
    </Card>
  );
}
