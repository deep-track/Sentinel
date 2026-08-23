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

//If IPRS is unavailable, submission is queued for manual verification 
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