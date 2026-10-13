import { CircleCheck, Clock, Loader2, X, type LucideIcon } from "lucide-react";
import type { BadgeTone } from "./ui";

export type Verdict = "pass" | "review" | "reject" | null;
export type VerificationStatus = "queued" | "processing" | "completed" | "failed";

const TYPE_LABELS: Record<string, string> = {
  idp: "KYC",
  kyb: "KYB",
  kyi: "KYI",
  document: "IDP",
  aml: "AML",
  liveness: "Liveness",
};

export function typeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return TYPE_LABELS[type] ?? type.toUpperCase();
}

/** Verdict badge for a verification (falls back to its processing status). */
export function verdictBadge(
  verdict: Verdict,
  status: VerificationStatus,
): { tone: BadgeTone; label: string; icon: LucideIcon } {
  if (status === "failed") return { tone: "red", label: "failed", icon: X };
  if (verdict === "pass") return { tone: "green", label: "passed", icon: CircleCheck };
  if (verdict === "reject") return { tone: "red", label: "flagged", icon: X };
  if (verdict === "review") return { tone: "blue", label: "review", icon: Clock };
  return { tone: "neutral", label: status === "processing" ? "processing" : "queued", icon: Loader2 };
}

export const VERDICT_FILTERS = [
  { value: "all", label: "All verdicts" },
  { value: "pass", label: "Passed" },
  { value: "review", label: "Review" },
  { value: "reject", label: "Flagged" },
  { value: "pending", label: "In progress / failed" },
] as const;
export type VerdictFilter = (typeof VERDICT_FILTERS)[number]["value"];

export function matchesVerdictFilter(filter: VerdictFilter, verdict: Verdict, status: VerificationStatus) {
  if (filter === "all") return true;
  if (filter === "pending") return verdict === null || status === "failed";
  return verdict === filter && status !== "failed";
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US").format(value);
}

export function formatPct(confidence: number | null | undefined): string {
  return confidence === null || confidence === undefined ? "—" : `${(confidence * 100).toFixed(1)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export type ReviewPriority = "low" | "normal" | "high";
export type ReviewTrigger = "client_dispute" | "auto_escalation" | "internal_flag";
export type ReviewStatus = "pending" | "in_review" | "resolved";

export const REVIEW_PRIORITY: Record<ReviewPriority, { tone: BadgeTone; label: string }> = {
  high: { tone: "red", label: "P1" },
  normal: { tone: "amber", label: "P2" },
  low: { tone: "neutral", label: "P3" },
};

export const REVIEW_TRIGGER_LABELS: Record<ReviewTrigger, string> = {
  client_dispute: "Client dispute",
  auto_escalation: "Auto-escalation",
  internal_flag: "Internal flag",
};

/** Compact age, e.g. "12m", "5h", "3d". */
export function formatAge(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(Math.floor(ms / 60_000), 0)}m`;
  if (ms < 48 * 3_600_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export const PLAN_LABELS = { trial: "Trial", starter: "Starter", growth: "Growth", enterprise: "Enterprise" } as const;
export type Plan = keyof typeof PLAN_LABELS;

export type ClientStatus = "active" | "suspended" | "trial_expired";
export function clientStatusBadge(status: ClientStatus): { tone: BadgeTone; label: string } {
  if (status === "active") return { tone: "green", label: "active" };
  if (status === "suspended") return { tone: "red", label: "suspended" };
  return { tone: "neutral", label: "trial expired" };
}

/** Local-time boundaries for "today" and "this month", recomputed each minute by callers. */
export function timeBoundaries(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return { now: now.getTime(), dayStart, monthStart };
}
