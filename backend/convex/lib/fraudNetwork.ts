import { normalizeName } from "./amlMatching";
import { nameTokens } from "./nameMatching";

// Sentinel's fraud network (fraudNetwork.ts): fingerprints of the
// identifiers used in checks (ID and document numbers, phone numbers,
// emails), so the same identifier turning up with a different person is
// caught - within a client, and across clients that opt in. Only keyed
// hashes are stored (HMAC-SHA256 with a key only Sentinel holds): never the
// identifier, the name or the date of birth, and findings never say which
// client saw what.

export const IDENTIFIER_KINDS = ["id_number", "document_number", "phone", "email"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export type Identifier = { kind: IdentifierKind; value: string };

export function normalizeIdentifier(kind: IdentifierKind, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (kind === "email") {
    const email = text.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  if (kind === "phone") {
    let digits = text.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) digits = digits.slice(1);
    // Kenyan numbers: 07xx / 01xx -> 2547xx / 2541xx.
    if (/^0[17]\d{8}$/.test(digits)) digits = `254${digits.slice(1)}`;
    return /^\d{9,15}$/.test(digits) ? digits : null;
  }
  const id = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return id.length >= 5 ? id : null;
}

// The meaningful name parts (canonical spelling), for comparing names by
// their hashed parts.
export function namePartsForHash(name: string): string[] {
  return [...new Set(nameTokens(normalizeName(name)))].filter((part) => part.length > 1);
}

// Share of the smaller set of name parts found in the other.
export function namePartOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 1; // unknown: don't call it a different name
  const [small, large] = left.length <= right.length ? [left, right] : [right, left];
  const set = new Set(large);
  return small.filter((part) => set.has(part)).length / small.length;
}

export type StoredSignal = {
  kind: IdentifierKind;
  clientId: string;
  verificationId: string;
  nameParts: string[];
  dob: string | null;
  outcome: "pass" | "review" | "reject" | "fraud";
  shared: boolean;
  createdAt: number;
};

export type Finding = {
  kind: IdentifierKind;
  signal: "different_name" | "different_date_of_birth" | "linked_to_fraud" | "many_identities";
  severity: "high" | "medium";
  scope: "your checks" | "the Sentinel network";
  count: number;
  message: string;
};

const LABELS: Record<IdentifierKind, string> = { id_number: "ID number", document_number: "document number", phone: "phone number", email: "email address" };

// Findings for one identifier from the earlier signals carrying it. Own
// signals always count; other clients' only when both took part in the
// network.
export function findingsFor(
  kind: IdentifierKind,
  current: { clientId: string; verificationId: string; nameParts: string[]; dob: string | null; network: boolean },
  earlier: StoredSignal[],
): Finding[] {
  const visible = earlier.filter((signal) => signal.verificationId !== current.verificationId && (signal.clientId === current.clientId || (current.network && signal.shared)));
  if (!visible.length) return [];
  const findings: Finding[] = [];
  const scopeOf = (signals: StoredSignal[]) => (signals.every((signal) => signal.clientId === current.clientId) ? "your checks" : "the Sentinel network");
  const label = LABELS[kind];
  const personal = kind === "id_number" || kind === "document_number";

  const otherNames = visible.filter((signal) => namePartOverlap(signal.nameParts, current.nameParts) < 0.5);
  if (otherNames.length) {
    const distinct = new Set(otherNames.map((signal) => signal.nameParts.join(" "))).size;
    findings.push({
      kind,
      signal: personal ? "different_name" : "many_identities",
      severity: personal || distinct >= 3 ? "high" : "medium",
      scope: scopeOf(otherNames),
      count: distinct,
      message: personal
        ? `This ${label} was used with ${distinct === 1 ? "a different name" : `${distinct} different names`} in ${scopeOf(otherNames)}.`
        : `This ${label} was used by ${distinct} other ${distinct === 1 ? "person" : "people"} in ${scopeOf(otherNames)}.`,
    });
  }
  if (personal && current.dob) {
    const otherDob = visible.filter((signal) => signal.dob && signal.dob !== current.dob);
    if (otherDob.length) {
      findings.push({ kind, signal: "different_date_of_birth", severity: "high", scope: scopeOf(otherDob), count: otherDob.length, message: `This ${label} was used with a different date of birth in ${scopeOf(otherDob)}.` });
    }
  }
  const fraud = visible.filter((signal) => signal.outcome === "fraud");
  if (fraud.length) {
    findings.push({ kind, signal: "linked_to_fraud", severity: "high", scope: scopeOf(fraud), count: fraud.length, message: `This ${label} was in ${fraud.length === 1 ? "a check" : `${fraud.length} checks`} rejected for fraud in ${scopeOf(fraud)}.` });
  }
  return findings;
}

export function needsReview(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === "high");
}

// Identifiers in a check, by type (KYC, documents, AML, KYB directors).
export function identifiersOf(verification: { type: string; input?: unknown; result?: unknown }): { identifiers: Identifier[]; name: string | null; dob: string | null } {
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const result = (verification.result ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const identifiers: Identifier[] = [];
  const add = (kind: IdentifierKind, value: unknown) => {
    const valueText = text(value);
    if (valueText) identifiers.push({ kind, value: valueText });
  };
  let name: string | null = null;
  let dob: string | null = null;
  if (verification.type === "idp") {
    add("id_number", input.idNumber);
    name = [text(input.firstName), text(input.lastName)].filter(Boolean).join(" ") || null;
    dob = text(input.dateOfBirth);
  } else if (verification.type === "document") {
    const fields = ((result.identity as { fields?: Record<string, unknown> } | undefined)?.fields ?? {}) as Record<string, unknown>;
    // A national ID's number is the person's ID number (as in KYC and AML
    // checks) unless the card carries a separate personal number.
    add(fields.documentType === "national_id" && !text(fields.personalNumber) ? "id_number" : "document_number", fields.documentNumber);
    add("id_number", fields.personalNumber);
    name = text(fields.fullName) ?? ([text(fields.givenNames), text(fields.surname)].filter(Boolean).join(" ") || text(input.expectedName));
    dob = text(fields.dateOfBirth);
  } else if (verification.type === "aml" && input.entityType !== "entity") {
    add("id_number", input.idNumber);
    name = text(input.subjectName);
    dob = text(input.dateOfBirth);
  }
  return { identifiers, name, dob: dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null };
}

// Document flags that point to a forged, edited or AI-made document.
export const FRAUD_FLAG_CODES = new Set([
  "ai_generation_parameters",
  "ai_generator_metadata",
  "edited_with_software",
  "mrz_check_digit_failed",
  "mrz_mismatch",
  "issued_before_birth",
  "pdf_modified_after_creation",
]);

const FRAUD_WORDS = /fraud|forg|tamper|fake|impersonat|stolen|synthetic|counterfeit/i;

// A rejection for fraud (rather than, say, an expired document or a
// sanctions match): fraud flags on the document, or a reviewer's reason.
export function isFraudRejection(result: unknown, reviewReason?: string | null): boolean {
  if (reviewReason && FRAUD_WORDS.test(reviewReason)) return true;
  const flags = ((result ?? {}) as { flags?: Array<{ code?: string }> }).flags ?? [];
  return flags.some((flag) => typeof flag.code === "string" && FRAUD_FLAG_CODES.has(flag.code));
}

export type NetworkSummary = { checkedAt: number; network: boolean; identifiers: number; findings: Finding[] };

// The note added to the reason when the network sends a check to review.
export function reviewNote(findings: Finding[]): string {
  const strong = findings.filter((finding) => finding.severity === "high");
  return `Fraud network: ${strong.map((finding) => finding.message).slice(0, 3).join(" ")}`;
}
