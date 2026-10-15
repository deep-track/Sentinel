import { CREDIT_VALUE, moneyToCredits, type BillingCurrency, type Plan } from "./pricing";

// Invoice arithmetic and limits (billing.ts). Amounts are in the invoice
// currency with 2 decimals; Paystack takes subunits (cents).

export type InvoiceLine = { description: string; quantity: number; unitPrice: number; amount: number };

export const TOP_UP_LIMITS: Record<BillingCurrency, { min: number; max: number }> = {
  USD: { min: 50, max: 50_000 },
  KES: { min: 1_000, max: 5_000_000 },
};

// Suggested top-up amounts on the Billing page.
export const TOP_UP_PRESETS: Record<BillingCurrency, number[]> = {
  USD: [100, 500, 1_000, 5_000],
  KES: [4_000, 20_000, 100_000, 400_000],
};

export const PAYMENT_TERMS_DAYS = 14;
export const MAX_VAT_RATE_PCT = 30;

export const round2 = (value: number) => Math.round(value * 100) / 100;

export function invoiceTotals(lines: InvoiceLine[], vatRatePct: number) {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const vat = round2((subtotal * vatRatePct) / 100);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

export function invoiceNumber(year: number, sequence: number): string {
  return `DT-${year}-${String(sequence).padStart(4, "0")}`;
}

// A top-up of `amount`: the credits it buys on the client's plan (KES plans
// with a bonus get it on top-ups too) and its invoice line. KES amounts are
// rounded down to whole credits.
export function topUpQuote(amount: number, currency: BillingCurrency, plan: Plan): { error: string } | { amount: number; credits: number; line: InvoiceLine } {
  const limits = TOP_UP_LIMITS[currency];
  if (!Number.isFinite(amount) || amount < limits.min || amount > limits.max) {
    return { error: `Top-ups are ${currency} ${limits.min.toLocaleString("en-US")}–${limits.max.toLocaleString("en-US")}.` };
  }
  const whole = currency === "KES" ? Math.floor(amount / CREDIT_VALUE.KES) * CREDIT_VALUE.KES : round2(amount);
  const credits = moneyToCredits(whole, currency, plan);
  return {
    amount: whole,
    credits,
    line: { description: `Sentinel credits top-up (${credits.toLocaleString("en-US")} credits)`, quantity: 1, unitPrice: whole, amount: whole },
  };
}

export const toSubunits = (amount: number) => Math.round(amount * 100);

export function cleanEmail(value: string | undefined | null): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : null;
}
