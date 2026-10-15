import { nameMatchScore } from "./documentChecks";
import { normalizeCompanyName, normalizeRegistrationNumber } from "./kybChecks";
import type { ComponentOutcome } from "./kybChecks";

// Kenya Business Registration Service (BRS) lookup through MetaMap
// GovChecks (POST /govchecks/v1/ke/brs). MetaMap may answer straight away
// or later at the callback URL; both carry the same { data, error } body.
// Credentials: METAMAP_CLIENT_ID / METAMAP_CLIENT_SECRET (dashboard →
// Integration). Without them the lookup is skipped.

export const METAMAP_API_BASE = "https://api.prod.metamap.com";
export const BRS_PATH = "/govchecks/v1/ke/brs";

export type BrsShareholder = { name: string; shares: string | null; idType: string | null; idNumber: string | null };
export type BrsRecord = {
  registrationNumber: string | null;
  companyName: string | null;
  companyType: string | null;
  registrationDate: string | null;
  active: boolean | null;
  kraPin: string | null;
  physicalAddress: string | null;
  shareholders: BrsShareholder[];
};
export type BrsLookup =
  | { status: "found"; record: BrsRecord }
  | { status: "not_found"; message: string }
  | { status: "pending" }
  | { status: "error"; message: string };

export function isKenya(country: string | undefined | null): boolean {
  return typeof country === "string" && /^(ke|ken|kenya)$/i.test(country.trim());
}

export function metamapConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.METAMAP_CLIENT_ID?.trim() && env.METAMAP_CLIENT_SECRET?.trim());
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);

function shareholdersOf(value: unknown): BrsShareholder[] {
  const list = Array.isArray(value) ? value.flat() : [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ name: text(item.name) ?? "", shares: text(item.shares), idType: text(item.idType), idNumber: text(item.idNumber) }))
    .filter((item) => item.name)
    .slice(0, 100);
}

// Reads a GovChecks response or callback body.
export function readBrsResponse(body: unknown): BrsLookup {
  if (!body || typeof body !== "object") return { status: "error", message: "MetaMap returned an empty response." };
  const { data, error } = body as { data?: unknown; error?: { code?: unknown; message?: unknown } | null };
  if (error && typeof error === "object") {
    const code = text(error.code) ?? "";
    const message = (text(error.message) ?? "The registry lookup failed.").slice(0, 300);
    return /notFound/i.test(code) ? { status: "not_found", message } : { status: "error", message };
  }
  if (!data || typeof data !== "object") return { status: "pending" };
  const d = data as Record<string, unknown>;
  const status = d.registrationStatus;
  return {
    status: "found",
    record: {
      registrationNumber: text(d.registrationNumber),
      companyName: text(d.companyName),
      companyType: text(d.companyType),
      registrationDate: text(d.registrationDate),
      active: typeof status === "boolean" ? status : typeof status === "string" ? /^(true|registered|active)$/i.test(status.trim()) : null,
      kraPin: text(d.kraPIN),
      physicalAddress: text(d.physicalAddress),
      shareholders: shareholdersOf(d.shareHolders ?? d.shareholders),
    },
  };
}

export type RegistryCheck = { name: string; status: "passed" | "failed" | "not_applicable"; detail?: string };

// Compares the registry record with what the client declared. Shareholders
// on the register who weren't declared are returned so they can be screened.
export function compareBrs(
  lookup: BrsLookup,
  declared: { businessName: string; registrationNumber: string; people: string[] },
): { outcome: ComponentOutcome; checks: RegistryCheck[]; undeclaredShareholders: BrsShareholder[] } {
  if (lookup.status === "pending" || lookup.status === "error") {
    return { outcome: { verdict: "unavailable", reason: lookup.status === "error" ? lookup.message : "The registry didn't answer in time." }, checks: [], undeclaredShareholders: [] };
  }
  if (lookup.status === "not_found") {
    return {
      outcome: { verdict: "review", reason: `Registration number ${declared.registrationNumber} wasn't found in the Kenya Business Registration Service.` },
      checks: [{ name: "Found in the BRS register", status: "failed" }],
      undeclaredShareholders: [],
    };
  }
  const { record } = lookup;
  const checks: RegistryCheck[] = [{ name: "Found in the BRS register", status: "passed", detail: record.registrationNumber ?? undefined }];
  const issues: string[] = [];

  const nameScore = record.companyName ? nameMatchScore(normalizeCompanyName(declared.businessName), normalizeCompanyName(record.companyName)) : null;
  checks.push({ name: "Registered name matches", status: nameScore === null ? "not_applicable" : nameScore >= 0.8 ? "passed" : "failed", detail: record.companyName ?? undefined });
  if (nameScore !== null && nameScore < 0.8) issues.push(`the register shows "${record.companyName}", not "${declared.businessName}"`);

  if (record.registrationNumber && normalizeRegistrationNumber(record.registrationNumber) !== normalizeRegistrationNumber(declared.registrationNumber)) {
    issues.push(`the register returned number ${record.registrationNumber}`);
  }

  checks.push({ name: "Registration is active", status: record.active === null ? "not_applicable" : record.active ? "passed" : "failed" });
  if (record.active === false) issues.push("the registration isn't active");

  const undeclaredShareholders = record.shareholders.filter((holder) => !declared.people.some((person) => nameMatchScore(person, holder.name) >= 0.67));
  if (record.shareholders.length > 0) {
    checks.push({
      name: "Shareholders on the register were declared",
      status: undeclaredShareholders.length ? "failed" : "passed",
      detail: `${record.shareholders.length - undeclaredShareholders.length}/${record.shareholders.length} declared`,
    });
  }
  if (undeclaredShareholders.length) issues.push(`shareholders on the register weren't declared: ${undeclaredShareholders.slice(0, 5).map((holder) => holder.name).join(", ")}`);

  return {
    outcome: issues.length ? { verdict: "review", reason: `Registry check: ${issues.join("; ")}.` } : { verdict: "pass", reason: "Matches the Kenya Business Registration Service record." },
    checks,
    undeclaredShareholders,
  };
}

// OAuth client-credentials token (valid for an hour).
export async function metamapToken(clientId: string, clientSecret: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const response = await fetchImpl(`${METAMAP_API_BASE}/oauth`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`MetaMap authentication failed (HTTP ${response.status})`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("MetaMap authentication returned no token");
  return body.access_token;
}

export async function requestBrs(
  params: { registrationNumber: string; callbackUrl: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BrsLookup> {
  const token = await metamapToken(params.clientId, params.clientSecret, fetchImpl);
  const response = await fetchImpl(`${METAMAP_API_BASE}${BRS_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: params.registrationNumber.trim(), callbackURL: params.callbackUrl }),
  });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const read = readBrsResponse(body);
    return read.status === "not_found" ? read : { status: "error", message: `The registry lookup failed (HTTP ${response.status}).` };
  }
  return body ? readBrsResponse(body) : { status: "pending" };
}
