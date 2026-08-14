import { callInternalService } from "./internalFetch";

export type IprsQuery = {
  idNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
};

export type IprsResponseStatus =
  | "MATCH"
  | "PARTIAL_MATCH"
  | "NO_MATCH"
  | "INVALID"
  | "REVOKED"
  | "TIMEOUT";

export type IprsResult = {
  status: IprsResponseStatus;
};

// Section 6.1's response-handling table. This is the single source of
// truth for what each IPRS status means downstream — riskEngine.ts
// calls this rather than re-encoding the table itself, so the two
// can't drift out of sync.
//
//   MATCH          -> pass, proceed to AML screening
//   PARTIAL_MATCH  -> hold for manual review (name variation)
//   NO_MATCH       -> flag high fraud risk, escalate to compliance
//   INVALID        -> reject immediately, return error to client
//   REVOKED        -> hard reject, flag for compliance team
//   TIMEOUT        -> queue for manual verification, notify client of delay
export type IprsAction =
  | "proceed_to_aml"
  | "hold_for_review"
  | "escalate_high_fraud_risk"
  | "reject_immediately"
  | "hard_reject_compliance"
  | "queue_manual_notify_delay";

export function resolveIprsAction(status: IprsResponseStatus): IprsAction {
  switch (status) {
    case "MATCH":
      return "proceed_to_aml";
    case "PARTIAL_MATCH":
      return "hold_for_review";
    case "NO_MATCH":
      return "escalate_high_fraud_risk";
    case "INVALID":
      return "reject_immediately";
    case "REVOKED":
      return "hard_reject_compliance";
    case "TIMEOUT":
      return "queue_manual_notify_delay";
  }
}

// Section 6: "If IPRS is unavailable, submission is queued for manual
// verification — never auto-rejected." So a thrown error (network
// failure, not a TIMEOUT status from IPRS itself) must be caught by the
// caller and treated the same as a TIMEOUT status, not as a hard
// failure. riskEngine.ts is responsible for that catch — this client
// just does the retry/timeout mechanics per Section 6's own spec
// (10s timeout, 3 retries, exponential backoff) and re-throws if all
// retries are exhausted.
export async function queryIprs(query: IprsQuery): Promise<IprsResult> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callInternalService<{ status: IprsResponseStatus }>(
        "/internal/iprs/query",
        {
          id_number: query.idNumber,
          first_name: query.firstName,
          last_name: query.lastName,
          date_of_birth: query.dateOfBirth,
          gender: query.gender,
        },
        { timeoutMs: 10_000 },
      );
      return { status: raw.status };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const backoffMs = 2 ** attempt * 500; // 500ms, 1s, 2s
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("IPRS query failed after retries");
}