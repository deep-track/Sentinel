import type { Doc } from "../_generated/dataModel";

export const DISPUTE_WINDOW_DAYS = 90;
export const MAX_OPEN_DISPUTES = 50;
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 2000;

// Why a result can't be disputed, or null when it can: only a finished
// pass or reject, within the window, that isn't already in review or
// disputed.
export function disputeBlocker(params: {
  verification: Pick<Doc<"verifications">, "status" | "verdict" | "completedAt" | "updatedAt" | "createdAt">;
  reviews: Array<Pick<Doc<"reviewQueue">, "status" | "triggerType">>;
  now: number;
}): string | null {
  const { verification, reviews, now } = params;
  if (verification.status !== "completed") return "Only finished checks can be disputed.";
  if (verification.verdict !== "pass" && verification.verdict !== "reject") return "Only a pass or a rejection can be disputed. Cases in review are decided in Reviews.";
  const finishedAt = verification.completedAt ?? verification.updatedAt ?? verification.createdAt;
  if (now - finishedAt > DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return `Results can be disputed for ${DISPUTE_WINDOW_DAYS} days.`;
  if (reviews.some((row) => row.status !== "resolved" && row.triggerType === "client_dispute")) return "This result is already disputed.";
  if (reviews.some((row) => row.status !== "resolved")) return "This check has an open review case.";
  return null;
}

export function cleanDisputeReason(reason: string): string | { error: string } {
  const trimmed = reason.trim().replace(/\s+\n/g, "\n");
  if (trimmed.length < MIN_REASON_LENGTH) return { error: `Explain the dispute in at least ${MIN_REASON_LENGTH} characters.` };
  if (trimmed.length > MAX_REASON_LENGTH) return { error: `The reason is limited to ${MAX_REASON_LENGTH} characters.` };
  return trimmed;
}
