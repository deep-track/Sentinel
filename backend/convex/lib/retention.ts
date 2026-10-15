// Retention: which checks are past a client's retention period, and which
// of those must be kept for now (holds).

export type HoldReason = "openCase" | "monitoring" | "str" | "unfinished";

export const HOLD_LABELS: Record<HoldReason, string> = {
  openCase: "an open review case or dispute",
  monitoring: "active AML monitoring",
  str: "a suspicious transaction report",
  unfinished: "the check hasn't finished",
};

// Checks created before this are past the retention period.
export function retentionCutoff(retentionMonths: number, now: number): number {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  return cutoff.getTime();
}

// Why a check past retention must be kept, or null to remove it. A report
// to the FRC and an open case have their own retention; a customer still
// monitored is still a customer.
export function holdReason(params: {
  status: string;
  hasOpenCase: boolean;
  hasActiveMonitoring: boolean;
  hasStr: boolean;
}): HoldReason | null {
  if (params.status !== "completed" && params.status !== "failed") return "unfinished";
  if (params.hasOpenCase) return "openCase";
  if (params.hasActiveMonitoring) return "monitoring";
  if (params.hasStr) return "str";
  return null;
}

export const PURGED_INPUT = { purged: true } as const;

export function purgedResult(purgedAt: number) {
  return { purged: true, purgedAt, reason: "Personal data removed after the retention period." };
}
