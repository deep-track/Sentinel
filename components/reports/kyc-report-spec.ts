import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";
import { FRAUD_NETWORK_HEADING, FRAUD_NETWORK_HINT, fraudNetworkRows } from "./fraud-network-rows";
import { checkTone, dateTime, REVIEW_SIGNATURES, type ReportBlock, type ReportSpec } from "./report-spec";
import type { Tone } from "./pdf-document";

// The KYC identity report as a PDF spec (from verifications.get on an
// "idp" record). Thresholds mirror backend/convex/lib/riskEngine.ts, as on
// the KYC page.

type Step = Record<string, unknown> | { error: string } | undefined;
export type KycRecord = {
  reference: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  input: unknown;
  result?: { liveness?: Step; docScan?: Step; iprs?: Step; aml?: Step; fraudNetwork?: NetworkSummary } | null;
  failureReason?: string | null;
  disputeReason?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};

const STEP_ERRORS: Record<string, string> = {
  upstream_timeout: "The verification provider timed out before responding.",
  upstream_unavailable: "The verification provider was unavailable.",
  upstream_http_error: "The verification provider returned an error.",
  upstream_invalid_response: "The verification provider returned a response that couldn't be read.",
  upstream_misconfigured: "This check isn't configured on the platform yet.",
  internal_error: "An internal error stopped this check.",
};

export function maskId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "-";
  return text.length <= 4 ? text : `${"*".repeat(Math.min(text.length - 4, 6))}${text.slice(-4)}`;
}

function field(input: unknown, key: string): string | null {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function kycVerdict(record: KycRecord): { label: string; tone: Tone } {
  if (record.verdict === "pass") return { label: "Approved", tone: "green" };
  if (record.verdict === "reject") return { label: "Declined", tone: "red" };
  if (record.verdict === "review") return { label: "Needs review", tone: "amber" };
  if (record.status === "failed") return { label: "Could not be verified", tone: "red" };
  return { label: "In progress", tone: "neutral" };
}

type StepRow = { name: string; result: string; tone: Tone; detail: string };

function stepRow(name: string, step: Step, read: (data: Record<string, unknown>) => Omit<StepRow, "name">, skipped: string): StepRow {
  if (!step) return { name, result: "Not run", tone: "neutral", detail: skipped };
  if ("error" in step && typeof step.error === "string") return { name, result: "Error", tone: "red", detail: STEP_ERRORS[step.error] ?? "This check could not be completed." };
  return { name, ...read(step as Record<string, unknown>) };
}

export function kycReportSpec(record: KycRecord, organization: string | null = null): ReportSpec {
  const input = record.input;
  const name = [field(input, "firstName"), field(input, "lastName")].filter(Boolean).join(" ") || "Identity verification";
  const result = record.result ?? {};
  const stillImage = field(input, "selfieUrl") !== null && field(input, "livenessMediaType") === "jpeg_frames";

  const steps: StepRow[] = [
    stepRow("Document authenticity", result.docScan, (d) => {
      const fakeScore = Number(d.fakeScore ?? 0);
      const flags = Array.isArray(d.flags) ? (d.flags as string[]) : [];
      const passed = fakeScore <= 0.25 && flags.length === 0;
      return { result: passed ? "Passed" : "Failed", tone: passed ? "green" : "red", detail: `${String(d.documentType ?? "Document")}; forgery score ${(fakeScore * 100).toFixed(1)}% (pass at 25% or less); flags: ${flags.length ? flags.join(", ") : "none"}` };
    }, "This step did not run."),
    stepRow("Liveness", result.liveness, (d) => {
      const score = Number(d.livenessScore ?? 0);
      const deepfake = Boolean(d.deepfakeFlag);
      if (stillImage) return { result: "Not valid", tone: "amber", detail: "Computed from a single uploaded still photo, which can't prove the person was present." };
      const passed = score >= 0.85 && !deepfake;
      return { result: passed ? "Passed" : "Failed", tone: passed ? "green" : "red", detail: `Liveness score ${(score * 100).toFixed(1)}% (pass at 85% or more); deepfake flagged: ${deepfake ? "yes" : "no"}` };
    }, "Not collected: the selfie-upload flow doesn't include liveness, so the person's presence wasn't confirmed."),
    stepRow("Identity registry (IPRS)", result.iprs, (d) => {
      const status = String(d.status ?? "");
      return { result: status.replace(/_/g, " ") || "-", tone: status === "MATCH" ? "green" : status === "PARTIAL_MATCH" ? "amber" : "red", detail: status === "MATCH" ? "The details match the national registry." : status === "PARTIAL_MATCH" ? "Some details match the national registry." : "The details don't match the national registry." };
    }, "This step did not run."),
    stepRow("AML / sanctions screening", result.aml, (d) => {
      const status = String(d.status ?? "");
      const matches = Array.isArray(d.matches) ? (d.matches as Array<{ source: string; program: string; matchScore: number; matchedCountry: string | null }>) : [];
      return {
        result: status.replace(/_/g, " ") || "-",
        tone: status === "CLEAR" ? "green" : status === "PEP" ? "amber" : "red",
        detail: matches.length ? matches.map((m) => `${m.source.replace(/_/g, " ")} - ${m.program} (${m.matchScore}% match${m.matchedCountry ? `, ${m.matchedCountry}` : ""})`).join("; ") : "No matches.",
      };
    }, "This step did not run."),
  ];

  const verdict = kycVerdict(record);
  const notes: ReportBlock[] = [];
  if (record.verdict === "review" && result && !result.liveness) notes.push({ kind: "callout", tone: "amber", label: "Held for review", text: "Liveness was not collected, so this verification can't be approved automatically." });

  return {
    title: "KYC Identity Report",
    reference: record.reference,
    organization,
    eyebrow: `KYC identity verification${organization ? ` - ${organization}` : ""}`,
    subject: name,
    verdict,
    summary: record.failureReason ?? null,
    facts: [
      ["Submitted", dateTime(record.createdAt)],
      ["Completed", dateTime(record.completedAt)],
      ["Processing time", record.completedAt ? `${((record.completedAt - record.createdAt) / 1000).toFixed(1)} s` : "-"],
      ["Checks passed", `${steps.filter((step) => step.tone === "green").length} of ${steps.length}`],
    ],
    sections: [
      {
        heading: "Person verified",
        blocks: [
          {
            kind: "rows",
            rows: [
              ["Name", name],
              ["Date of birth", field(input, "dateOfBirth")],
              ["Gender", (field(input, "gender") ?? "").replace(/^./, (c) => c.toUpperCase()) || null],
              ["ID number", maskId(field(input, "idNumber"))],
            ],
          },
        ],
      },
      {
        heading: "Verification steps",
        hint: "Each step of the identity check, its result and why.",
        blocks: [
          ...notes,
          { kind: "table", headers: ["Step", "Result", "Detail"], rows: steps.map((step) => [step.name, step.result, step.detail]), widths: [0.26, 0.16, 0.58], toneColumn: 1, tones: steps.map((step) => step.tone) },
        ],
      },
      ...(result?.fraudNetwork ? [{ heading: FRAUD_NETWORK_HEADING, hint: FRAUD_NETWORK_HINT, blocks: [{ kind: "rows", rows: fraudNetworkRows(result.fraudNetwork) } as ReportBlock] }] : []),
      ...(record.disputeReason ? [{ heading: "Dispute", blocks: [{ kind: "rows", rows: [["Reason given", record.disputeReason]] } as ReportBlock] }] : []),
      ...(record.verdict && record.verdict !== "pass" ? [{ heading: "Review", hint: "For the reviewer's decision.", blocks: [REVIEW_SIGNATURES] }] : []),
      {
        heading: "About this report",
        blocks: [
          {
            kind: "paragraph",
            small: true,
            text: "Sentinel checks the identity document for forgery, confirms the person is present with a liveness check, matches the details against the national registry (IPRS) and screens the person against sanctions and PEP lists. ID numbers are masked. A failed or held step is a lead for review, not proof of fraud.",
          },
        ],
      },
    ],
    fileName: `KYC-report-${record.reference}.pdf`,
  };
}

export { checkTone };
