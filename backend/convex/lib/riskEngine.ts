import {
  checkLiveness,
  passesLivenessThreshold,
  type LivenessRequest,
} from "./awsClients/livenessClient";
import {
  scanDocument,
  passesDocScanThreshold,
  type DocScanRequest,
} from "./awsClients/docScanClient";
import { queryIprs, resolveIprsAction, type IprsQuery } from "./awsClients/iprsClient";
import { queryAml, resolveAmlAction, type AmlMatch } from "./awsClients/amlClient";

export type IdpOrchestrationInput = {
  // Optional: KYC's plain-selfie flow doesn't collect this. Only the
  // standalone Liveness flow (and any future combined flow) supplies it.
  liveness?: LivenessRequest;
  document: DocScanRequest;
  identity: IprsQuery;
  amlEntityName: string;
};

export type ReviewTrigger = {
  triggerType: "auto_escalation";
  triggerReason: string;
};

export type IdpOrchestrationResult = {
  verdict: "pass" | "review" | "reject";
  reason: string;
  reviewTrigger?: ReviewTrigger;
  stepResults: {
    liveness?: Awaited<ReturnType<typeof checkLiveness>> | { error: string };
    docScan?: Awaited<ReturnType<typeof scanDocument>> | { error: string };
    iprs?: { status: string } | { error: string };
    aml?: { status: string; matches: AmlMatch[] } | { error: string };
  };
};

function hasUncertainWatchlistMatch(matches: AmlMatch[]): boolean {
  return matches.some((m) => m.matchScore >= 60 && m.matchScore <= 85);
}

export async function orchestrateIdpVerification(
  input: IdpOrchestrationInput,
): Promise<IdpOrchestrationResult> {
  const stepResults: IdpOrchestrationResult["stepResults"] = {};

  // Liveness only runs when the caller actually collected it. We skip the
  // AWS call entirely rather than sending it an empty/fake payload —
  // KYC's plain-selfie flow simply never has this step.
  const [livenessOutcome, docScanOutcome] = await Promise.allSettled([
    input.liveness ? checkLiveness(input.liveness) : Promise.resolve(undefined),
    scanDocument(input.document),
  ]);

  if (input.liveness) {
    if (livenessOutcome.status === "rejected") {
      stepResults.liveness = { error: String(livenessOutcome.reason) };
    } else {
      stepResults.liveness = livenessOutcome.value as Awaited<ReturnType<typeof checkLiveness>>;
    }
  }
  if (docScanOutcome.status === "rejected") {
    stepResults.docScan = { error: String(docScanOutcome.reason) };
  } else {
    stepResults.docScan = docScanOutcome.value;
  }

  // Failure on either scan -> review, never reject. Liveness only counts
  // as a failure here if it was actually requested in the first place.
  const livenessErrored = Boolean(input.liveness) && livenessOutcome.status === "rejected";
  if (livenessErrored || docScanOutcome.status === "rejected") {
    return {
      verdict: "review",
      reason: "Liveness or document scan service unavailable — held for manual review.",
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: "Scan service infrastructure failure" },
      stepResults,
    };
  }

  const livenessResult =
    input.liveness && livenessOutcome.status === "fulfilled"
      ? livenessOutcome.value
      : undefined;
  const livenessPassed = livenessResult
    ? passesLivenessThreshold(livenessResult)
    : !input.liveness; // not collected for this flow — nothing to threshold-check
  const docScanPassed = passesDocScanThreshold(docScanOutcome.value);

  if (!livenessPassed || !docScanPassed) {
    const reasons: string[] = [];
    if (!livenessPassed) reasons.push("liveness below threshold or deepfake flagged");
    if (!docScanPassed) reasons.push("document authenticity below threshold or flags present");
    return {
      verdict: "review",
      reason: `Held for review: ${reasons.join("; ")}.`,
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: reasons.join("; ") },
      stepResults,
    };
  }

  // IPRS
  let iprsStatus: string;
  try {
    const iprsResult = await queryIprs(input.identity);
    stepResults.iprs = { status: iprsResult.status };
    iprsStatus = iprsResult.status;
  } catch (err) {
    stepResults.iprs = { error: String(err) };
    return {
      verdict: "review",
      reason: "IPRS unavailable after retries — queued for manual verification.",
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: "IPRS service timeout/unavailable" },
      stepResults,
    };
  }

  const iprsAction = resolveIprsAction(iprsStatus as Parameters<typeof resolveIprsAction>[0]);

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
      return {
        verdict: "review",
        reason: "IPRS partial match — name variation requires manual review.",
        reviewTrigger: { triggerType: "auto_escalation", triggerReason: "IPRS partial match" },
        stepResults,
      };
    case "escalate_high_fraud_risk":
      return {
        verdict: "review",
        reason: "ID not found in IPRS — high fraud risk, escalated to compliance.",
        reviewTrigger: { triggerType: "auto_escalation", triggerReason: "IPRS no match — high fraud risk" },
        stepResults,
      };
    case "queue_manual_notify_delay":
      return {
        verdict: "review",
        reason: "IPRS timed out — queued for manual verification, client notified of delay.",
        reviewTrigger: { triggerType: "auto_escalation", triggerReason: "IPRS timeout" },
        stepResults,
      };
    case "proceed_to_aml":
      break;
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
    stepResults.aml = { error: String(err) };
    return {
      verdict: "review",
      reason: "AML screening service unavailable — held for manual review.",
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: "AML service infrastructure failure" },
      stepResults,
    };
  }

  const amlAction = resolveAmlAction({ status: amlStatus as any, matches: amlMatches });

  if (amlAction === "hard_stop_compliance_alert") {
    return {
      verdict: "reject",
      reason: "Sanctions list hit — hard stop, compliance alerted.",
      stepResults,
    };
  }

  if (hasUncertainWatchlistMatch(amlMatches)) {
    return {
      verdict: "review",
      reason: "Watchlist match score in the 60-85 uncertain range — escalated for review.",
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: "Uncertain-confidence watchlist match" },
      stepResults,
    };
  }

  if (amlAction === "enhanced_due_diligence") {
    return {
      verdict: "review",
      reason: "PEP match — flagged for enhanced due diligence.",
      reviewTrigger: { triggerType: "auto_escalation", triggerReason: "PEP match" },
      stepResults,
    };
  }

  return { verdict: "pass", reason: "All checks clear.", stepResults };
}
