// Self-service trials (signups.ts): limits and checks, no Convex imports.

export const TRIAL_DAYS = 14;
// Trial credits: about 25 checks either way (KES 1,000 / US$10 worth).
export const TRIAL_CREDITS: Record<"USD" | "KES", number> = { USD: 1_000, KES: 25 };
export const TRIAL_RPM_CAP = 30;
export const MAX_REQUESTS_PER_EMAIL_PER_DAY = 3;
export const MAX_REQUESTS_PER_DAY = 300;

// Personal mailboxes: a trial needs a work email, so each company gets one
// trial and DeepTrack knows who it is talking to.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isWorkEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain.includes(".") && !FREE_EMAIL_DOMAINS.has(domain);
}

export function currencyForCountry(country: string): "USD" | "KES" {
  return country.trim().toUpperCase() === "KE" ? "KES" : "USD";
}

export type SignupInput = { name: string; email: string; company: string; country: string };

// Cleans the public form; returns the error to show, or the clean values.
export function cleanSignup(input: SignupInput): { error: string } | SignupInput {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  const company = input.company.trim().replace(/\s+/g, " ");
  const country = input.country.trim().toUpperCase();
  if (name.length < 2 || name.length > 100) return { error: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (!isWorkEmail(email)) return { error: "Use your work email address. Personal mailboxes (Gmail, Outlook…) can't start a trial." };
  if (company.length < 2 || company.length > 120) return { error: "Enter your organization's name." };
  if (!/^[A-Z]{2}$/.test(country)) return { error: "Choose your country." };
  return { name, email, company, country };
}

export function trialDaysLeft(trialEndsAt: number | undefined, now: number): number | null {
  if (trialEndsAt === undefined) return null;
  return Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)));
}
