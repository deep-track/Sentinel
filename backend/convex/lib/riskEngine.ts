import {
  checkLiveness,
  passesLivenessThreshold,
  type LivenessRequest,
  type LivenessResult,
} from "./awsClients/livenessClient";
import {
  scanDocument,
  passesDocScanThreshold,
  type DocScanRequest,
  type DocScanResult,
} from "./awsClients/docScanClient";
import { queryIprs, resolveIprsAction, type IprsQuery } from "./awsClients/iprsClient";
import {
  queryAml,
  resolveAmlAction,
  HIGH_CONFIDENCE_MATCH_SCORE,
  type AmlMatch,
} from "./awsClients/amlClient";
import { upstreamErrorCode, type UpstreamErrorCode } from "./awsClients/internalFetch";

// This engine FAILS CLOSED: every branch that is not an explicit, recognised
// "all clear" ends in review or reject. Only the final return yields "pass".

export type IdpOrchestrationInput = {
  // Optional: KYC's plain-selfie flow doesn't collect this. A verification
  // without liveness can never auto-pass; it is held for manual review.
  liveness?: LivenessRequest;
  document: DocScanRequest;
  identity: IprsQuery;
  amlEntityName: string;
};

export type ReviewTrigger = {
  triggerType: "auto_escalation";
  triggerReason: string;
};

// Generic, client-safe error code. Raw upstream error text is never stored.
export type StepError = { error: UpstreamErrorCode | "internal_error" };

export type IdpOrchestrationResult = {
  verdict: "pass" | "review" | "reject";
  reason: string;
  reviewTrigger?: ReviewTrigger;
  stepResults: {
    // Absent when liveness was not collected for this flow.
    liveness?: LivenessResult | StepError;
    docScan?: DocScanResult | StepError;
    iprs?: { status: string } | StepError;
    aml?: { status: string; matches: AmlMatch[] } | StepError;
  };
};

const LIVENESS_NOT_COLLECTED = "liveness not collected";

function hasUncertainWatchlistMatch(matches: AmlMatch[]): boolean {
  return matches.some((m) => m.matchScore >= 60 && m.matchScore <= HIGH_CONFIDENCE_MATCH_SCORE);
}

function stepError(step: string, err: unknown): StepError {
  const code = upstreamErrorCode(err);
  // Server-side log only. UpstreamServiceError messages are already generic.
  console.error(`[riskEngine] ${step} failed (${code})`, err instanceof Error ? err.message : "");
  return { error: code };
}

export async function orchestrateIdpVerification(
  input: IdpOrchestrationInput,
): Promise<IdpOrchestrationResult> {
  const stepResults: IdpOrchestrationResult["stepResults"] = {};
  const livenessCollected = Boolean(input.liveness);

  const review = (reason: string, triggerReason: string): IdpOrchestrationResult => ({
    verdict: "review",
    reason,
    reviewTrigger: { triggerType: "auto_escalation", triggerReason },
    stepResults,
  });

  // Liveness only runs when the caller actually collected it. We skip the
  // AWS call entirely rather than sending it an empty/fake payload.
  const [livenessOutcome, docScanOutcome] = await Promise.allSettled([
    input.liveness ? checkLiveness(input.liveness) : Promise.resolve(undefined),
    scanDocument(input.document),
  ]);

  if (livenessCollected) {
    stepResults.liveness =
      livenessOutcome.status === "rejected"
        ? stepError("liveness", livenessOutcome.reason)
        : (livenessOutcome.value as LivenessResult);
  }
  stepResults.docScan =
    docScanOutcome.status === "rejected"
      ? stepError("docScan", docScanOutcome.reason)
      : docScanOutcome.value;

  // Failure on either scan -> review, never reject.
  const livenessErrored = livenessCollected && livenessOutcome.status === "rejected";
  if (livenessErrored || docScanOutcome.status === "rejected") {
    return review(
      "Liveness or document scan service unavailable — held for manual review.",
      "Scan service infrastructure failure",
    );
  }

  const livenessResult =
    livenessCollected && livenessOutcome.status === "fulfilled"
      ? (livenessOutcome.value as LivenessResult | undefined)
      : undefined;
  const docScanResult = docScanOutcome.status === "fulfilled" ? docScanOutcome.value : undefined;

  const reasons: string[] = [];
  if (livenessCollected && !(livenessResult && passesLivenessThreshold(livenessResult))) {
    reasons.push("liveness below threshold or deepfake flagged");
  }
  if (!(docScanResult && passesDocScanThreshold(docScanResult))) {
    reasons.push("document authenticity below threshold or flags present");
  }
  if (reasons.length > 0) {
    if (!livenessCollected) reasons.push(LIVENESS_NOT_COLLECTED);
    return review(`Held for review: ${reasons.join("; ")}.`, reasons.join("; "));
  }

  // IPRS
  let iprsStatus: string;
  try {
    const iprsResult = await queryIprs(input.identity);
    stepResults.iprs = { status: iprsResult.status };
    iprsStatus = iprsResult.status;
  } catch (err) {
    stepResults.iprs = stepError("iprs", err);
    return review(
      "IPRS unavailable after retries — queued for manual verification.",
      "IPRS service timeout/unavailable",
    );
  }

  const iprsAction = resolveIprsAction(iprsStatus);
  switch (iprsAction) {
    case "reject_immediately":
      return { verdict: "reject", reason: "Invalid ID format.", stepResults };
    case "hard_reject_compliance":
      return {
        verdict: "reject",
        reason: "ID reported lost or stolen — flagged for compliance.",
        stepResults,
      };
    case "hold_for_review":
      return review(
        "IPRS partial match — name variation requires manual review.",
        "IPRS partial match",
      );
    case "escalate_high_fraud_risk":
      return review(
        "ID not found in IPRS — high fraud risk, escalated to compliance.",
        "IPRS no match — high fraud risk",
      );
    case "queue_manual_notify_delay":
      return review(
        "IPRS timed out — queued for manual verification, client notified of delay.",
        "IPRS timeout",
      );
    case "proceed_to_aml":
      break;
    case "review_unrecognised_status":
    default:
      return review(
        "IPRS returned an unrecognised result — held for manual review.",
        "IPRS unrecognised status",
      );
  }

  // AML
  let amlStatus: string;
  let amlMatches: AmlMatch[];
  try {
    const amlResult = await queryAml({ entityName: input.amlEntityName, entityType: "person" });
    stepResults.aml = { status: amlResult.status, matches: amlResult.matches };
    amlStatus = amlResult.status;
    amlMatches = amlResult.matches;
  } catch (err) {
    stepResults.aml = stepError("aml", err);
    return review(
      "AML screening service unavailable — held for manual review.",
      "AML service infrastructure failure",
    );
  }

  const amlAction = resolveAmlAction({ status: amlStatus, matches: amlMatches });
  switch (amlAction) {
    case "hard_stop_compliance_alert":
      return {
        verdict: "reject",
        reason: "Sanctions list hit — hard stop, compliance alerted.",
        stepResults,
      };
    case "high_confidence_match_review":
      return review(
        `Watchlist match score above ${HIGH_CONFIDENCE_MATCH_SCORE} — escalated for compliance review.`,
        "High-confidence watchlist match",
      );
    case "enhanced_due_diligence":
      return review("PEP match — flagged for enhanced due diligence.", "PEP match");
    case "adverse_media_due_diligence":
      return review(
        "Adverse media match — flagged for enhanced due diligence.",
        "Adverse media match",
      );
    case "clear":
      break;
    case "review_unrecognised_status":
    default:
      return review(
        "AML screening returned an unrecognised status — held for manual review.",
        "AML unrecognised status",
      );
  }

  if (hasUncertainWatchlistMatch(amlMatches)) {
    return review(
      `Watchlist match score in the 60-${HIGH_CONFIDENCE_MATCH_SCORE} uncertain range — escalated for review.`,
      "Uncertain-confidence watchlist match",
    );
  }

  if (!livenessCollected) {
    return review(
      "All automated checks clear, but liveness was not collected — held for manual review.",
      "Liveness not collected",
    );
  }

  return { verdict: "pass", reason: "All checks clear.", stepResults };
}
