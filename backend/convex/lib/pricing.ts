// Sentinel pricing (DeepTrack Sentinel Pricing & Service Overview).
//
// Two price lists, both cheaper per check on bigger plans:
//
//   USD (international clients): 1 credit = $0.01; each check costs its plan
//     price from the published list (e.g. AML $0.60 = 60 credits on Starter,
//     $0.35 = 35 credits on Enterprise).
//   KES (Kenyan clients): 1 credit = KES 40, the price of one KYC check at the
//     Kenyan market rate (KES 30–50). Checks cost whole credits on every plan;
//     bigger plans get bonus credits, which lowers the effective price per
//     check without going below the market rate (Enterprise: KES 33.33).
//
// Each check is charged in credits when it completes (lib/credits.ts). The
// USD→KES rate in billingSettings is only used to show combined revenue.
//
// No imports, so tests and the portal can use this file directly.

export const PLANS = ["trial", "starter", "growth", "business", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export const BILLING_CURRENCIES = ["USD", "KES"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

// List price of one credit, by currency.
export const CREDIT_VALUE: Record<BillingCurrency, number> = { USD: 0.01, KES: 40 };

// Bonus credits on the annual prepayment, by plan (KES only; USD discounts
// are built into its per-plan prices).
export const PLAN_BONUS: Record<BillingCurrency, Record<Plan, number>> = {
  USD: { trial: 0, starter: 0, growth: 0, business: 0, enterprise: 0 },
  KES: { trial: 0, starter: 0, growth: 0.1, business: 0.15, enterprise: 0.2 },
};

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  business: "Business",
  enterprise: "Enterprise",
};

// Annual prepayment per plan, in each currency.
export const PLAN_PREPAY: Record<BillingCurrency, Record<Plan, number>> = {
  USD: { trial: 0, starter: 2_500, growth: 5_500, business: 12_000, enterprise: 17_000 },
  KES: { trial: 0, starter: 250_000, growth: 550_000, business: 1_200_000, enterprise: 1_700_000 },
};

export const SERVICES = ["kyc_identity", "identity_document", "proof_of_address", "liveness", "aml", "kyb"] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  kyc_identity: "KYC identity check (document + liveness)",
  identity_document: "Document verification",
  proof_of_address: "Proof of address verification",
  liveness: "Liveness facial verification",
  aml: "AML screening & ongoing monitoring",
  kyb: "Enhanced KYB",
};

type PriceTable = Record<Exclude<Plan, "trial">, Record<Service, number>>;

// Price per check in credits.
//
// USD is the price list as published. Proof of address on Starter is $1.10
// (the list's "$0.11" read as a typo: prices fall with plan size for every
// other service). KYC = document verification + liveness.
//
// KES: KYC, document verification, AML and liveness 1 credit (KES 40) each,
// proof of address 2, Enhanced KYB 5, on every plan; plan bonuses do the
// discounting.
const KES_PRICES: Record<Service, number> = { kyc_identity: 1, identity_document: 1, proof_of_address: 2, liveness: 1, aml: 1, kyb: 5 };

export const PRICES: Record<BillingCurrency, PriceTable> = {
  USD: {
    starter: { kyc_identity: 130, identity_document: 80, proof_of_address: 110, liveness: 50, aml: 60, kyb: 200 },
    growth: { kyc_identity: 75, identity_document: 50, proof_of_address: 80, liveness: 25, aml: 50, kyb: 150 },
    business: { kyc_identity: 63, identity_document: 45, proof_of_address: 70, liveness: 18, aml: 40, kyb: 95 },
    enterprise: { kyc_identity: 45, identity_document: 30, proof_of_address: 65, liveness: 15, aml: 35, kyb: 90 },
  },
  KES: { starter: KES_PRICES, growth: KES_PRICES, business: KES_PRICES, enterprise: KES_PRICES },
};

// Trial is billed at Starter prices.
function tableFor(currency: BillingCurrency, plan: Plan): Record<Service, number> {
  const prices = PRICES[currency] ?? PRICES.USD;
  return plan === "trial" ? prices.starter : prices[plan] ?? prices.starter;
}

export type VerificationKind = "idp" | "kyb" | "aml" | "liveness" | "kyi" | "document";

// The service one check is billed as.
//   idp (KYC identity check)  KYC (document + liveness; its AML step is included)
//   document (IDP)            identity document, or proof of address
//   aml                       AML screening; ongoing monitoring of the subject is included
//   kyi                       retired; old records only, billed like KYC
export function serviceFor(type: VerificationKind, documentKind?: "identity" | "proof_of_address"): Service {
  switch (type) {
    case "idp":
    case "kyi":
      return "kyc_identity";
    case "document":
      return documentKind === "proof_of_address" ? "proof_of_address" : "identity_document";
    case "aml":
      return "aml";
    case "liveness":
      return "liveness";
    case "kyb":
      return "kyb";
  }
}

// Credits one check costs for a client on `plan` billed in `currency`.
export function priceCredits(
  plan: Plan,
  currency: BillingCurrency,
  type: VerificationKind,
  documentKind?: "identity" | "proof_of_address",
): number {
  return tableFor(currency, plan)[serviceFor(type, documentKind)];
}

// What one credit is actually worth on a plan: the list price less the plan
// bonus (a KES Enterprise credit is worth 40 / 1.2 = KES 33.33).
export function effectiveCreditValue(plan: Plan, currency: BillingCurrency): number {
  return CREDIT_VALUE[currency] / (1 + PLAN_BONUS[currency][plan]);
}

// Money value of credits for a client on `plan`, in their currency. Used for
// revenue, statements and showing balances.
export function creditsToMoney(credits: number, currency: BillingCurrency, plan: Plan = "starter"): number {
  return Math.round(credits * effectiveCreditValue(plan, currency) * 100) / 100;
}

// Credits bought by a payment, including the plan bonus (rounded down).
export function moneyToCredits(amount: number, currency: BillingCurrency, plan: Plan = "starter"): number {
  return Math.floor((amount / CREDIT_VALUE[currency]) * (1 + PLAN_BONUS[currency][plan]) + 1e-9);
}

// Credits the annual prepayment of a plan loads.
export function planCredits(plan: Plan, currency: BillingCurrency): number {
  return moneyToCredits(PLAN_PREPAY[currency][plan], currency, plan);
}

// USD value of an amount, for combined Back Office totals. KES needs a rate.
export function toUsd(amount: number, currency: BillingCurrency, usdToKes: number | null): number | null {
  if (currency === "USD") return amount;
  return usdToKes && usdToKes > 0 ? Math.round((amount / usdToKes) * 100) / 100 : null;
}

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// A plan's full price list in one currency, for the portal, the Back Office
// and GET /v1/credits.
export function priceList(plan: Plan, currency: BillingCurrency) {
  const table = tableFor(currency, plan);
  return SERVICES.map((service) => ({
    service,
    label: SERVICE_LABELS[service],
    credits: table[service],
    // Effective price on this plan (after any plan bonus).
    amount: creditsToMoney(table[service], currency, plan),
    currency,
  }));
}
