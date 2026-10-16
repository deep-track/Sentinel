"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Check, CreditCard, FileText, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { formatMoney } from "@/backend/convex/lib/pricing";

// Choose a plan on the Billing page. Prices are shown in USD; Kenyan
// organizations pay the KES equivalent at DeepTrack's current rate.
// Starter, Growth and Business are bought here (Paystack, or an invoice to
// pay by bank transfer / M-Pesa); Enterprise goes to the sales team.

type PlanOption = {
  plan: "starter" | "growth" | "business" | "enterprise";
  label: string;
  priceUsd: number | null;
  purchasable: boolean;
  chargeAmount: number | null;
  pendingInvoiceId: string | null;
};
type Overview = { currency: "USD" | "KES"; plan: string; paystackEnabled: boolean; canPay: boolean; plans: PlanOption[]; salesContact: string };

const HIGHLIGHT: PlanOption["plan"] = "growth";

const FEATURES: Record<PlanOption["plan"], { tagline: string; items: string[] }> = {
  starter: {
    tagline: "For teams getting started with digital onboarding.",
    items: ["KYC identity checks (document + liveness)", "AML screening and ongoing monitoring", "Document and proof of address verification", "Business (KYB) verification"],
  },
  growth: {
    tagline: "For growing volumes, at a lower price per check.",
    items: ["Everything in Starter", "Lower price on every check"],
  },
  business: {
    tagline: "For established institutions with high volumes.",
    items: ["Everything in Growth", "Lower price again on every check"],
  },
  enterprise: {
    tagline: "For banks and large institutions with custom needs.",
    items: ["Everything in Business", "Our best price per check", "Custom contract and invoicing terms"],
  },
};

export function PlanPicker({ clientId }: { clientId: string }) {
  const data = useAuthedQuery(anyApi.billing.overview, { clientId }) as Overview | null | undefined;
  const startPlanPurchase = useAction(anyApi.billing.startPlanPurchase);
  const requestPlanInvoice = useMutation(anyApi.billing.requestPlanInvoice);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.plans) return null;
  const salesHref = `mailto:${data.salesContact}?subject=${encodeURIComponent("Sentinel Enterprise plan")}`;

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
        Billed yearly, in advance. Bigger plans cost less per check.
        {data.currency === "KES" ? " Prices are in US dollars; you pay the equivalent in Kenya shillings at today's rate." : ""}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((option) => {
          const current = data.plan === option.plan;
          const features = FEATURES[option.plan];
          const enterprise = option.plan === "enterprise";
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
              {enterprise ? (
                <p className="mt-2 text-2xl font-bold">Custom</p>
              ) : (
                <p className="mt-2 text-2xl font-bold">
                  {formatMoney(option.priceUsd, "USD")}
                  <span className="text-sm font-normal text-muted-foreground"> / year</span>
                </p>
              )}
              {data.currency === "KES" && option.chargeAmount ? <p className="text-xs text-muted-foreground">Paid as {formatMoney(option.chargeAmount, "KES")}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">{features.tagline}</p>
              <ul className="mt-3 flex-1 space-y-1 text-xs">
                {features.items.map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-2">
                {enterprise ? (
                  <Button asChild className="w-full" size="sm" variant="outline">
                    <a href={salesHref}>
                      <Mail className="mr-1.5 h-4 w-4" /> Speak to us
                    </a>
                  </Button>
                ) : !data.canPay ? null : !option.purchasable ? (
                  <Button asChild className="w-full" size="sm" variant="outline">
                    <a href={`mailto:${data.salesContact}?subject=${encodeURIComponent(`Sentinel ${option.label} plan`)}`}>
                      <Mail className="mr-1.5 h-4 w-4" /> Ask for a quote
                    </a>
                  </Button>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!data.canPay ? <p className="mt-3 text-xs text-muted-foreground">Only Admins can change the plan.</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Questions about plans or a custom contract?{" "}
        <a href={salesHref} className="underline">
          Speak to our sales team
        </a>{" "}
        ({data.salesContact}).
      </p>
    </Card>
  );
}
