import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ClientRole } from "./rbac";

// A client's own settings (Settings in the client portal), managed by its
// Admin: the review workflow, screening rules, notifications, security, data
// retention and the organization profile. Stored per client in
// `clientSettings`, one optional object per section; every field is
// optional so a row written before a field existed still validates, and
// `resolveSettings` fills anything missing from DEFAULTS. Unset = Sentinel's
// standard behaviour, so a client that never opens Settings sees no change.

// ── Roles ───────────────────────────────────────────────────────────────────

export const CLIENT_ROLES = ["client_admin", "reviewer", "compliance_analyst", "developer", "viewer"] as const;

export const ROLE_LABELS: Record<ClientRole, string> = {
  client_admin: "Admin",
  reviewer: "Reviewer",
  compliance_analyst: "Analyst",
  developer: "Developer",
  viewer: "Viewer / Auditor",
};

// Seniority for review decisions. Developers and viewers never decide.
const DECISION_RANK: Record<string, number> = {
  compliance_analyst: 1,
  reviewer: 2,
  client_admin: 3,
  internal_admin: 3,
};

export type DecisionRole = "compliance_analyst" | "reviewer" | "client_admin";
export const DECISION_ROLES: DecisionRole[] = ["compliance_analyst", "reviewer", "client_admin"];
export const REVIEW_WORK_ROLES: ClientRole[] = ["client_admin", "reviewer", "compliance_analyst"];

export function decisionRank(role: string): number {
  return DECISION_RANK[role] ?? 0;
}

export function canDecide(role: string, required: DecisionRole): boolean {
  return decisionRank(role) > 0 && decisionRank(role) >= decisionRank(required);
}

// ── Case categories ─────────────────────────────────────────────────────────

// What a review case is about, most serious first. Decides who may clear it
// and whether it needs a second person (four-eyes).
export const CASE_CATEGORIES = ["sanctions", "pep", "adverse_media", "document_fraud", "high_risk", "standard"] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CASE_CATEGORY_LABELS: Record<CaseCategory, string> = {
  sanctions: "Sanctions hit",
  pep: "PEP",
  adverse_media: "Adverse media",
  document_fraud: "Document fraud or AI-generated",
  high_risk: "Other high-risk case",
  standard: "Standard case",
};

export const QUEUES = ["kyc", "aml", "idp", "kyb", "liveness"] as const;
export type Queue = (typeof QUEUES)[number];
export const QUEUE_LABELS: Record<Queue, string> = {
  kyc: "KYC (identity)",
  aml: "AML screening",
  idp: "Documents (IDP)",
  kyb: "Business (KYB)",
  liveness: "Liveness",
};

export function queueForType(type: Doc<"verifications">["type"]): Queue {
  switch (type) {
    case "aml":
      return "aml";
    case "document":
      return "idp";
    case "kyb":
      return "kyb";
    case "liveness":
      return "liveness";
    default:
      return "kyc";
  }
}

// ── Validators ──────────────────────────────────────────────────────────────

const decisionRole = v.union(v.literal("compliance_analyst"), v.literal("reviewer"), v.literal("client_admin"));
const caseCategory = v.union(...CASE_CATEGORIES.map((category) => v.literal(category)));
const memberRole = v.union(...CLIENT_ROLES.map((role) => v.literal(role)));

export const reviewSettingsValidator = v.object({
  // Categories whose final decision needs a second person.
  fourEyes: v.optional(v.array(caseCategory)),
  // The person who ran a check can't make the final decision on it.
  makerChecker: v.optional(v.boolean()),
  // Lowest role that may make the final decision, per category.
  clearance: v.optional(
    v.object({
      sanctions: v.optional(decisionRole),
      pep: v.optional(decisionRole),
      adverse_media: v.optional(decisionRole),
      document_fraud: v.optional(decisionRole),
      high_risk: v.optional(decisionRole),
      standard: v.optional(decisionRole),
    }),
  ),
  assignment: v.optional(v.union(v.literal("manual"), v.literal("round_robin"))),
  // Hours to the final decision, by priority.
  deadlinesHours: v.optional(v.object({ high: v.optional(v.number()), normal: v.optional(v.number()), low: v.optional(v.number()) })),
  requireReasonCode: v.optional(v.boolean()),
  approveReasons: v.optional(v.array(v.string())),
  rejectReasons: v.optional(v.array(v.string())),
});

export const screeningSettingsValidator = v.object({
  // Minimum match score (70–95) for a watchlist or OpenSanctions hit to count.
  matchThreshold: v.optional(v.number()),
  // PEP classes treated as high risk (priority high, PEP clearance rules).
  highRiskPepClasses: v.optional(v.array(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)))),
  monitoringDefault: v.optional(v.boolean()),
  monitoringFrequency: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
  // Adverse media risk types (lib/adverseMedia.ts RISK_TYPES) to report.
  adverseMediaCategories: v.optional(v.array(v.string())),
  aiGeneratedAction: v.optional(v.union(v.literal("reject"), v.literal("review"))),
  documentFraudAction: v.optional(v.union(v.literal("reject"), v.literal("review"))),
  poaMaxAgeDays: v.optional(v.number()),
  // Proof of address types accepted (lib/documentChecks.ts POA_DOCUMENT_TYPES).
  acceptedPoaDocuments: v.optional(v.array(v.string())),
});

export const NOTIFICATION_EVENTS = [
  "sanctions_hit",
  "pep_hit",
  "high_risk_case",
  "review_assigned",
  "awaiting_approval",
  "review_overdue",
  "case_escalated",
  "monitoring_alert",
  "low_credit",
  "webhook_failing",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, { label: string; detail: string }> = {
  sanctions_hit: { label: "Sanctions hit", detail: "A screening matched a sanctions list." },
  pep_hit: { label: "PEP hit", detail: "A screening matched a politically exposed person." },
  high_risk_case: { label: "High-risk case", detail: "A check was rejected or flagged high priority." },
  review_assigned: { label: "Case assigned", detail: "Sent to the person a case is assigned to." },
  awaiting_approval: { label: "Awaiting approval", detail: "Sent to people who can approve a recommended decision." },
  review_overdue: { label: "Missed review deadline", detail: "A case passed its deadline without a decision." },
  case_escalated: { label: "Case escalated", detail: "A team member escalated a case for a senior decision." },
  monitoring_alert: { label: "Monitoring alert", detail: "Ongoing monitoring found a new or more severe hit." },
  low_credit: { label: "Low credits", detail: "The credit balance fell below the warning level." },
  webhook_failing: { label: "Webhook paused", detail: "A webhook endpoint kept failing and was paused." },
};

// Events sent to the people named by the event itself, not to roles.
export const PERSONAL_EVENTS: NotificationEvent[] = ["review_assigned", "awaiting_approval"];

const eventSettings = v.object({
  enabled: v.optional(v.boolean()),
  email: v.optional(v.boolean()),
  roles: v.optional(v.array(memberRole)),
});

export const notificationSettingsValidator = v.object({
  events: v.optional(
    v.object({
      sanctions_hit: v.optional(eventSettings),
      pep_hit: v.optional(eventSettings),
      high_risk_case: v.optional(eventSettings),
      review_assigned: v.optional(eventSettings),
      awaiting_approval: v.optional(eventSettings),
      review_overdue: v.optional(eventSettings),
      case_escalated: v.optional(eventSettings),
      monitoring_alert: v.optional(eventSettings),
      low_credit: v.optional(eventSettings),
      webhook_failing: v.optional(eventSettings),
    }),
  ),
  // Warn when the balance falls to this many credits. Unset = the plan's
  // usage threshold (clients.creditThresholdPct of creditLimit).
  lowCreditBalance: v.optional(v.number()),
});

export const securitySettingsValidator = v.object({
  requireMfa: v.optional(v.boolean()),
  // Sign out after this many idle minutes; 0 = off.
  sessionTimeoutMinutes: v.optional(v.number()),
  // Only these email domains can be invited (empty = any).
  allowedEmailDomains: v.optional(v.array(v.string())),
  // Portal access only from these IPs / CIDR ranges (empty = any).
  ipAllowlist: v.optional(v.array(v.string())),
  // Apply the allowlist to API key requests too.
  ipAllowlistApi: v.optional(v.boolean()),
});

export const dataSettingsValidator = v.object({
  retentionMonths: v.optional(v.number()),
});

export const REGULATORS = ["CBK", "CMA", "IRA", "SASRA", "RBA", "BRS", "FRC", "other"] as const;
export const REGULATOR_LABELS: Record<(typeof REGULATORS)[number], string> = {
  CBK: "Central Bank of Kenya",
  CMA: "Capital Markets Authority",
  IRA: "Insurance Regulatory Authority",
  SASRA: "Sacco Societies Regulatory Authority",
  RBA: "Retirement Benefits Authority",
  BRS: "Business Registration Service",
  FRC: "Financial Reporting Centre",
  other: "Other",
};

export const profileSettingsValidator = v.object({
  legalName: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  regulator: v.optional(v.union(...REGULATORS.map((regulator) => v.literal(regulator)))),
  regulatorOther: v.optional(v.string()),
  licenceNumber: v.optional(v.string()),
  address: v.optional(v.string()),
  complianceContactName: v.optional(v.string()),
  complianceContactEmail: v.optional(v.string()),
  complianceContactPhone: v.optional(v.string()),
  logoStorageId: v.optional(v.id("_storage")),
});

export type ReviewSettingsInput = Infer<typeof reviewSettingsValidator>;
export type ScreeningSettingsInput = Infer<typeof screeningSettingsValidator>;
export type NotificationSettingsInput = Infer<typeof notificationSettingsValidator>;
export type SecuritySettingsInput = Infer<typeof securitySettingsValidator>;
export type DataSettingsInput = Infer<typeof dataSettingsValidator>;
export type ProfileSettingsInput = Infer<typeof profileSettingsValidator>;

// ── Defaults ────────────────────────────────────────────────────────────────

export const AI_GENERATED_FLAG_CODES = [
  "ai_generator_metadata",
  "c2pa_ai_generated",
  "ai_generation_parameters",
  "c2pa_registry_ai_generated",
  "visual_ai_generated",
];

// Kenya's POCAMLA (s.46) requires customer and transaction records to be
// kept for at least seven years.
export const MIN_RETENTION_MONTHS = 84;
export const MAX_RETENTION_MONTHS = 240;
export const MIN_MATCH_THRESHOLD = 70;
export const MAX_MATCH_THRESHOLD = 95;
export const MAX_POA_AGE_DAYS = 365;
export const MAX_REASONS = 30;
export const MAX_REASON_LENGTH = 120;
export const MAX_DOMAINS = 20;
export const MAX_IP_RULES = 50;

export type ResolvedSettings = {
  review: {
    fourEyes: CaseCategory[];
    makerChecker: boolean;
    clearance: Record<CaseCategory, DecisionRole>;
    assignment: "manual" | "round_robin";
    deadlinesHours: { high: number; normal: number; low: number };
    requireReasonCode: boolean;
    approveReasons: string[];
    rejectReasons: string[];
  };
  screening: {
    matchThreshold: number;
    highRiskPepClasses: Array<1 | 2 | 3 | 4>;
    monitoringDefault: boolean;
    monitoringFrequency: "daily" | "weekly" | "monthly";
    adverseMediaCategories: string[] | null; // null = every category
    aiGeneratedAction: "reject" | "review";
    documentFraudAction: "reject" | "review";
    poaMaxAgeDays: number;
    acceptedPoaDocuments: string[] | null; // null = every recognised type
  };
  notifications: {
    events: Record<NotificationEvent, { enabled: boolean; email: boolean; roles: ClientRole[] }>;
    lowCreditBalance: number | null;
  };
  security: {
    requireMfa: boolean;
    sessionTimeoutMinutes: number;
    allowedEmailDomains: string[];
    ipAllowlist: string[];
    ipAllowlistApi: boolean;
  };
  data: { retentionMonths: number };
  profile: ProfileSettingsInput;
};

export const DEFAULTS: ResolvedSettings = {
  review: {
    fourEyes: ["sanctions", "pep", "document_fraud"],
    makerChecker: true,
    clearance: {
      sanctions: "client_admin",
      pep: "reviewer",
      adverse_media: "reviewer",
      document_fraud: "reviewer",
      high_risk: "reviewer",
      standard: "compliance_analyst",
    },
    assignment: "manual",
    deadlinesHours: { high: 24, normal: 72, low: 72 },
    requireReasonCode: true,
    approveReasons: [
      "False positive: different person or entity",
      "Hit reviewed: risk within appetite",
      "Document verified manually",
      "Enhanced due diligence completed",
      "Senior management approval obtained",
    ],
    rejectReasons: [
      "Confirmed sanctions match",
      "PEP: risk outside appetite",
      "Adverse media: risk outside appetite",
      "Fraudulent or altered document",
      "AI-generated document",
      "Insufficient or inconsistent information",
    ],
  },
  screening: {
    matchThreshold: MIN_MATCH_THRESHOLD,
    highRiskPepClasses: [1, 2],
    monitoringDefault: false,
    monitoringFrequency: "daily",
    adverseMediaCategories: null,
    aiGeneratedAction: "reject",
    documentFraudAction: "reject",
    poaMaxAgeDays: 90,
    acceptedPoaDocuments: null,
  },
  notifications: {
    events: {
      sanctions_hit: { enabled: true, email: true, roles: ["client_admin", "reviewer"] },
      pep_hit: { enabled: true, email: true, roles: ["client_admin", "reviewer"] },
      high_risk_case: { enabled: true, email: false, roles: ["client_admin", "reviewer"] },
      review_assigned: { enabled: true, email: true, roles: [] },
      awaiting_approval: { enabled: true, email: true, roles: [] },
      review_overdue: { enabled: true, email: true, roles: ["client_admin", "reviewer"] },
      case_escalated: { enabled: true, email: true, roles: ["client_admin", "reviewer"] },
      monitoring_alert: { enabled: true, email: true, roles: ["client_admin", "reviewer", "compliance_analyst"] },
      low_credit: { enabled: true, email: true, roles: ["client_admin"] },
      webhook_failing: { enabled: true, email: true, roles: ["client_admin", "developer"] },
    },
    lowCreditBalance: null,
  },
  security: {
    requireMfa: false,
    sessionTimeoutMinutes: 0,
    allowedEmailDomains: [],
    ipAllowlist: [],
    ipAllowlistApi: false,
  },
  data: { retentionMonths: MIN_RETENTION_MONTHS },
  profile: {},
};

// Merges a stored row onto DEFAULTS.
export function resolveSettings(row: Partial<Pick<Doc<"clientSettings">, "review" | "screening" | "notifications" | "security" | "data" | "profile">> | null): ResolvedSettings {
  const review = row?.review ?? {};
  const screening = row?.screening ?? {};
  const notifications = row?.notifications ?? {};
  const security = row?.security ?? {};
  const events = { ...DEFAULTS.notifications.events };
  for (const event of NOTIFICATION_EVENTS) {
    const stored = notifications.events?.[event];
    if (stored) events[event] = { ...events[event], ...definedOnly(stored) } as (typeof events)[NotificationEvent];
  }
  return {
    review: {
      ...DEFAULTS.review,
      ...definedOnly(review),
      clearance: { ...DEFAULTS.review.clearance, ...definedOnly(review.clearance ?? {}) },
      deadlinesHours: { ...DEFAULTS.review.deadlinesHours, ...definedOnly(review.deadlinesHours ?? {}) },
    } as ResolvedSettings["review"],
    screening: {
      ...DEFAULTS.screening,
      ...definedOnly(screening),
    } as ResolvedSettings["screening"],
    notifications: { events, lowCreditBalance: notifications.lowCreditBalance ?? null },
    security: { ...DEFAULTS.security, ...definedOnly(security) } as ResolvedSettings["security"],
    data: { ...DEFAULTS.data, ...definedOnly(row?.data ?? {}) },
    profile: row?.profile ?? {},
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export async function loadClientSettings(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">): Promise<ResolvedSettings> {
  const row = await ctx.db
    .query("clientSettings")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .unique();
  return resolveSettings(row);
}

// ── Validation (on save) ────────────────────────────────────────────────────

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function wholeNumber(value: number | undefined, label: string, min: number, max: number) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${label} must be a whole number from ${min} to ${max}.`);
}

function cleanList(values: string[] | undefined, label: string, maxItems: number, maxLength = MAX_REASON_LENGTH): string[] | undefined {
  if (values === undefined) return undefined;
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (cleaned.length > maxItems) invalid(`${label}: at most ${maxItems} entries.`);
  if (cleaned.some((value) => value.length > maxLength)) invalid(`${label}: each entry is at most ${maxLength} characters.`);
  return cleaned;
}

export function validateReviewSettings(input: ReviewSettingsInput): ReviewSettingsInput {
  for (const [priority, hours] of Object.entries(input.deadlinesHours ?? {})) {
    wholeNumber(hours, `The ${priority} priority deadline (hours)`, 1, 720);
  }
  const approveReasons = cleanList(input.approveReasons, "Approve reasons", MAX_REASONS);
  const rejectReasons = cleanList(input.rejectReasons, "Reject reasons", MAX_REASONS);
  const requireReasonCode = input.requireReasonCode ?? DEFAULTS.review.requireReasonCode;
  if (requireReasonCode && ((approveReasons && approveReasons.length === 0) || (rejectReasons && rejectReasons.length === 0))) {
    invalid("Reason codes are required, so keep at least one approve and one reject reason.");
  }
  return {
    ...input,
    fourEyes: input.fourEyes ? [...new Set(input.fourEyes)] : undefined,
    approveReasons,
    rejectReasons,
  };
}

export function validateScreeningSettings(input: ScreeningSettingsInput, known: { adverseMedia: readonly string[]; poaDocuments: readonly string[] }): ScreeningSettingsInput {
  wholeNumber(input.matchThreshold, "The match threshold", MIN_MATCH_THRESHOLD, MAX_MATCH_THRESHOLD);
  wholeNumber(input.poaMaxAgeDays, "The proof of address age limit (days)", 1, MAX_POA_AGE_DAYS);
  const adverseMediaCategories = input.adverseMediaCategories ? [...new Set(input.adverseMediaCategories)] : undefined;
  if (adverseMediaCategories) {
    if (adverseMediaCategories.length === 0) invalid("Choose at least one adverse media category, or screen all of them.");
    const unknown = adverseMediaCategories.filter((category) => !known.adverseMedia.includes(category));
    if (unknown.length) invalid(`Unknown adverse media categories: ${unknown.join(", ")}.`);
  }
  const acceptedPoaDocuments = input.acceptedPoaDocuments ? [...new Set(input.acceptedPoaDocuments)] : undefined;
  if (acceptedPoaDocuments) {
    if (acceptedPoaDocuments.length === 0) invalid("Accept at least one proof of address document type.");
    const unknown = acceptedPoaDocuments.filter((type) => !known.poaDocuments.includes(type) || type === "other");
    if (unknown.length) invalid(`Unknown proof of address types: ${unknown.join(", ")}.`);
  }
  return {
    ...input,
    highRiskPepClasses: input.highRiskPepClasses ? [...new Set(input.highRiskPepClasses)].sort() : undefined,
    adverseMediaCategories,
    acceptedPoaDocuments,
  };
}

export function validateNotificationSettings(input: NotificationSettingsInput): NotificationSettingsInput {
  if (input.lowCreditBalance !== undefined) wholeNumber(input.lowCreditBalance, "The low-credit warning", 0, 100_000_000);
  return input;
}

const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function validateSecuritySettings(input: SecuritySettingsInput): SecuritySettingsInput {
  if (input.sessionTimeoutMinutes !== undefined && input.sessionTimeoutMinutes !== 0) {
    wholeNumber(input.sessionTimeoutMinutes, "The idle timeout (minutes)", 5, 720);
  }
  const allowedEmailDomains = input.allowedEmailDomains
    ? cleanList(input.allowedEmailDomains.map(normalizeDomain), "Allowed email domains", MAX_DOMAINS, 253)
    : undefined;
  const badDomain = allowedEmailDomains?.find((domain) => !DOMAIN_PATTERN.test(domain));
  if (badDomain) invalid(`"${badDomain}" is not a valid email domain.`);
  const ipAllowlist = input.ipAllowlist ? cleanList(input.ipAllowlist, "IP allowlist", MAX_IP_RULES, 43) : undefined;
  const badRule = ipAllowlist?.find((rule) => parseIpRule(rule) === null);
  if (badRule) invalid(`"${badRule}" is not an IPv4 or IPv6 address or CIDR range.`);
  if (input.ipAllowlistApi && !(ipAllowlist && ipAllowlist.length)) invalid("Add at least one IP range before applying the allowlist to the API.");
  return { ...input, allowedEmailDomains, ipAllowlist };
}

export function validateDataSettings(input: DataSettingsInput): DataSettingsInput {
  wholeNumber(input.retentionMonths, "The retention period (months)", MIN_RETENTION_MONTHS, MAX_RETENTION_MONTHS);
  return input;
}

const MAX_PROFILE_TEXT = 300;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateProfileSettings(input: ProfileSettingsInput): ProfileSettingsInput {
  const cleaned: ProfileSettingsInput = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof ProfileSettingsInput, unknown]>) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > MAX_PROFILE_TEXT) invalid(`${key} is too long (max ${MAX_PROFILE_TEXT} characters).`);
      if (trimmed) (cleaned as Record<string, unknown>)[key] = trimmed;
    } else if (value !== undefined) {
      (cleaned as Record<string, unknown>)[key] = value;
    }
  }
  if (cleaned.complianceContactEmail && !EMAIL_PATTERN.test(cleaned.complianceContactEmail)) invalid("The compliance contact email is not valid.");
  if (cleaned.regulator !== "other") delete cleaned.regulatorOther;
  return cleaned;
}

// ── Email domains ───────────────────────────────────────────────────────────

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@").pop() ?? "";
}

export function emailAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

// ── IP allowlist ────────────────────────────────────────────────────────────

type IpRule = { version: 4 | 6; bits: bigint; prefix: number };

// BigInt() calls rather than literals: the project targets below ES2020.
const ZERO = BigInt(0);
const BITS_8 = BigInt(8);
const BITS_16 = BigInt(16);
const BITS_32 = BigInt(32);
const MASK_16 = BigInt(0xffff);
const MASK_32 = BigInt(0xffffffff);

function parseIpv4(value: string): bigint | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = ZERO;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << BITS_8) + BigInt(octet);
  }
  return result;
}

function parseIpv6(value: string): bigint | null {
  let address = value.toLowerCase();
  // IPv4-mapped tail (::ffff:1.2.3.4).
  const v4Tail = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const v4 = parseIpv4(v4Tail[2]);
    if (v4 === null) return null;
    address = `${v4Tail[1]}${(v4 >> BITS_16).toString(16)}:${(v4 & MASK_16).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let result = ZERO;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << BITS_16) + BigInt(parseInt(group, 16));
  }
  return result;
}

function parseIp(value: string): { version: 4 | 6; bits: bigint } | null {
  const trimmed = value.trim();
  const v4 = parseIpv4(trimmed);
  if (v4 !== null) return { version: 4, bits: v4 };
  const v6 = parseIpv6(trimmed);
  if (v6 === null) return null;
  // Treat IPv4-mapped IPv6 as IPv4.
  if (v6 >> BITS_32 === MASK_16) return { version: 4, bits: v6 & MASK_32 };
  return { version: 6, bits: v6 };
}

export function parseIpRule(rule: string): IpRule | null {
  const [address, prefixText, extra] = rule.trim().split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const width = ip.version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? width : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return null;
  return { version: ip.version, bits: ip.bits, prefix };
}

export function ipAllowed(ip: string | null | undefined, rules: string[]): boolean {
  if (rules.length === 0) return true;
  const parsed = ip ? parseIp(ip) : null;
  if (!parsed) return false;
  return rules.some((text) => {
    const rule = parseIpRule(text);
    if (!rule || rule.version !== parsed.version) return false;
    const width = BigInt(rule.version === 4 ? 32 : 128);
    const shift = width - BigInt(rule.prefix);
    return parsed.bits >> shift === rule.bits >> shift;
  });
}

// ── Review routing ──────────────────────────────────────────────────────────

type FlaggedLike = { source: string; categories?: string[]; pepClass?: number; riskLevel?: string };
type DocumentFlagLike = { code: string; severity: string };

// The most serious category a case falls under, from its check type, hits
// and flags.
export function caseCategoryFor(params: {
  type: Doc<"verifications">["type"];
  priority: "low" | "normal" | "high";
  flagged: FlaggedLike[];
  documentFlags: DocumentFlagLike[];
}): CaseCategory {
  const categories = new Set(params.flagged.flatMap((hit) => hit.categories ?? (hit.source === "ADVERSE_MEDIA" ? ["adverse_media"] : ["sanctions"])));
  if (categories.has("sanctions")) return "sanctions";
  if (categories.has("pep")) return "pep";
  if (categories.has("adverse_media")) return "adverse_media";
  if (params.documentFlags.some((flag) => flag.severity === "critical" || flag.severity === "high")) return "document_fraud";
  if (params.priority === "high" || categories.size > 0) return "high_risk";
  return "standard";
}

// Priority for a new case under the client's rules: a PEP in a high-risk
// class is always high priority.
export function priorityFor(
  base: "low" | "normal" | "high",
  flagged: FlaggedLike[],
  rules: ResolvedSettings["screening"],
): "low" | "normal" | "high" {
  if (base === "high") return base;
  const highRiskPep = flagged.some((hit) => hit.pepClass && rules.highRiskPepClasses.includes(hit.pepClass as 1 | 2 | 3 | 4));
  return highRiskPep ? "high" : base;
}

export function deadlineFor(createdAt: number, priority: "low" | "normal" | "high", rules: ResolvedSettings["review"]): number {
  return createdAt + rules.deadlinesHours[priority] * 60 * 60 * 1000;
}

export type DecisionCheck =
  | { ok: true; final: boolean }
  | { ok: false; reason: string };

// Whether `actor` may act on a case, and whether their decision is final
// (otherwise it is recorded as a recommendation for a second person).
export function checkDecision(params: {
  actor: { userId: string; role: string };
  category: CaseCategory;
  rules: ResolvedSettings["review"];
  makerId: string | null;
  recommendation: { by: string } | null;
}): DecisionCheck {
  const { actor, category, rules, makerId, recommendation } = params;
  if (decisionRank(actor.role) === 0) return { ok: false, reason: "Your role can't make review decisions." };
  const required = rules.clearance[category];
  const fourEyes = rules.fourEyes.includes(category);
  const cleared = canDecide(actor.role, required);
  // Internal admins (DeepTrack) are never the maker of a client's check.
  const isMaker = rules.makerChecker && makerId !== null && makerId === actor.userId;

  if (recommendation) {
    // Second step: someone other than the recommender, with clearance.
    if (recommendation.by === actor.userId) return { ok: false, reason: "A second person must approve your recommendation." };
    if (!cleared) return { ok: false, reason: `Only a ${roleName(required)} or above can approve this ${CASE_CATEGORY_LABELS[category].toLowerCase()} case.` };
    if (isMaker) return { ok: false, reason: "You ran this check, so someone else must make the final decision (maker-checker)." };
    return { ok: true, final: true };
  }
  // First step. Without clearance, or under four-eyes, or as the maker, the
  // decision is a recommendation.
  return { ok: true, final: cleared && !fourEyes && !isMaker };
}

function roleName(role: DecisionRole): string {
  return ROLE_LABELS[role];
}

// ── Screening rules (aml.ts) ────────────────────────────────────────────────

export type ScreeningRules = Pick<ResolvedSettings["screening"], "matchThreshold" | "adverseMediaCategories">;

export function monitoringIntervalMs(frequency: ResolvedSettings["screening"]["monitoringFrequency"]): number {
  const day = 24 * 60 * 60 * 1000;
  return frequency === "monthly" ? 30 * day : frequency === "weekly" ? 7 * day : day;
}

// ── Document rules (documents._complete) ────────────────────────────────────

// Applies the client's IDP rules to a pipeline verdict: AI-generated or
// other fraud rejections can be sent to review instead, and a proof of
// address of a type the client doesn't accept can never pass.
export function applyDocumentRules(
  verdict: "pass" | "review" | "reject",
  result: { flags?: DocumentFlagLike[]; documentKind?: string; proofOfAddress?: { fields?: { documentType?: string } } | null },
  rules: ResolvedSettings["screening"],
): { verdict: "pass" | "review" | "reject"; notes: string[] } {
  const notes: string[] = [];
  let next = verdict;
  const critical = (result.flags ?? []).filter((flag) => flag.severity === "critical");
  if (next === "reject" && critical.length > 0) {
    // Every reason for the rejection must be one the client sends to review.
    const hasAi = critical.some((flag) => AI_GENERATED_FLAG_CODES.includes(flag.code));
    const hasOther = critical.some((flag) => !AI_GENERATED_FLAG_CODES.includes(flag.code));
    const aiToReview = !hasAi || rules.aiGeneratedAction === "review";
    const otherToReview = !hasOther || rules.documentFraudAction === "review";
    if (aiToReview && otherToReview) {
      next = "review";
      notes.push("Sent to review instead of rejected, under your organization's document rules.");
    }
  }
  const poaType = result.proofOfAddress?.fields?.documentType;
  if (result.documentKind === "proof_of_address" && poaType && rules.acceptedPoaDocuments && !rules.acceptedPoaDocuments.includes(poaType)) {
    if (next === "pass") next = "review";
    notes.push(`A ${poaType.replace(/_/g, " ")} is not on your organization's accepted proof of address list.`);
  }
  return { verdict: next, notes };
}

// ── Low credit ──────────────────────────────────────────────────────────────

export function lowCreditLevel(client: Pick<Doc<"clients">, "creditLimit" | "creditThresholdPct">, settings: ResolvedSettings["notifications"]): number {
  if (settings.lowCreditBalance !== null) return settings.lowCreditBalance;
  return Math.floor((client.creditLimit * (100 - client.creditThresholdPct)) / 100);
}
