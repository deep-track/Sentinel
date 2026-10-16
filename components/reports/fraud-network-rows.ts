import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";

// The fraud network section of the PDF reports (backend/convex/fraudNetwork.ts).

export const FRAUD_NETWORK_HEADING = "Fraud network";
export const FRAUD_NETWORK_HINT = "Identifiers compared, as keyed fingerprints, with earlier checks for reuse by another person or in a fraud rejection.";

export function fraudNetworkRows(summary: NetworkSummary): Array<[string, string]> {
  const compared: [string, string] = [
    "Compared with",
    `${summary.network ? "Your checks and the Sentinel network" : "Your organization's checks"} (${summary.identifiers} identifier${summary.identifiers === 1 ? "" : "s"})`,
  ];
  if (!summary.findings.length) return [["Result", "No reuse found"], compared];
  return [...summary.findings.map((finding) => [finding.severity === "high" ? "Strong signal" : "Weak signal", finding.message] as [string, string]), compared];
}
