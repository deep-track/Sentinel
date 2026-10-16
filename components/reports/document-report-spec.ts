import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";
import { FRAUD_NETWORK_HEADING, FRAUD_NETWORK_HINT, fraudNetworkRows } from "./fraud-network-rows";
import { checkLabel, checkTone, dateTime, REVIEW_SIGNATURES, type ReportBlock, type ReportSection, type ReportSpec } from "./report-spec";
import type { Tone } from "./pdf-document";

// The IDP document report (identity document or proof of address) as a
// PDF spec, from documents.reportForClient.

type Flag = { code: string; severity: "critical" | "high" | "medium" | "low"; source: string; message: string };
type Check = { name: string; status: string; detail?: string };
export type DocumentReportData = {
  verification: {
    reference: string;
    status: string;
    verdict?: "pass" | "review" | "reject";
    failureReason?: string;
    createdAt: number;
    completedAt?: number;
    input?: { documentKind?: string; pages?: number; expectedName?: string | null; expectedAddress?: string | null; expectedDateOfBirth?: string | null; externalRef?: string | null } | null;
    result?: {
      fraudNetwork?: NetworkSummary;
      reason?: string;
      riskScore?: number;
      documentKind?: string;
      flags?: Flag[];
      checks?: Check[];
      identity?: {
        fields: Record<string, unknown> & { mrzLines?: string[]; hasFacePhoto?: boolean; hasSignature?: boolean };
        mrz: { format: string; documentNumber: string; issuingCountry: string; nationality: string; birthDate: string | null; expiryDate: string | null; surname: string; givenNames: string; checks: Array<{ name: string; valid: boolean }> } | null;
        age: number | null;
        isAdult: boolean | null;
        expectedNameMatch: number | null;
        expectedDateOfBirthMatch: boolean | null;
      };
      kraPin?: {
        fields: { pin: string | null; taxpayerName: string | null; taxpayerType: "individual" | "non_individual" | null; email: string | null; certificateDate: string | null; obligations: string[]; issuedByKra: boolean };
        nameMatch: number | null;
        registry?: { outcome: string; message: string; name: string | null; pinStatus: string | null; taxpayerType: string | null };
      };
      proofOfAddress?: {
        fields: { documentType: string; issuerName: string | null; holderName: string | null; address: string | null; issueDate: string | null; accountReference: string | null };
        nameMatch: number | null;
        addressMatch: number | null;
        documentAgeDays: number | null;
        maxDocumentAgeDays: number;
      };
      forensics?: { fileTypes: string[]; software: string[]; metadataAvailable?: boolean };
      vision?: { model: string; summary: string };
      ocr?: { status: string; averageConfidence: number | null; checked: string[]; missing: string[] };
      contentCredentials?: { status: string; matches: number };
    } | null;
  };
  clientName: string | null;
  review: { status: string; triggerReason: string; createdAt: number; resolutionAction: string | null; resolutionNotes: string | null; resolvedAt: number | null; resolvedByName: string | null } | null;
};

const SOURCE_LABELS: Record<string, string> = { file: "File forensics", mrz: "Machine-readable zone", rules: "Validation rules", vision: "AI visual review", ocr: "OCR cross-check" };
const SEVERITY_TONE: Record<Flag["severity"], Tone> = { critical: "red", high: "red", medium: "amber", low: "neutral" };
const DOCUMENT_TYPE_LABELS: Record<string, string> = { passport: "Passport", national_id: "National ID card", drivers_licence: "Driver's licence", residence_permit: "Residence permit", other: "Other" };
const IDENTITY_FIELDS: Array<[string, string]> = [
  ["documentType", "Document type"],
  ["issuingCountry", "Issuing country"],
  ["documentNumber", "Document number"],
  ["fullName", "Full name"],
  ["dateOfBirth", "Date of birth"],
  ["sex", "Sex"],
  ["nationality", "Nationality"],
  ["placeOfBirth", "Place of birth"],
  ["issueDate", "Issue date"],
  ["expiryDate", "Expiry date"],
  ["issuingAuthority", "Issuing authority"],
  ["serialNumber", "Serial number"],
  ["kenyanIdType", "Kenyan ID card"],
  ["address", "Address"],
];

const KENYAN_ID_LABELS: Record<string, string> = { maisha_card: "Maisha card", second_generation: "Second-generation ID" };
// Shown only when the document has them.
const OPTIONAL_FIELDS = new Set(["serialNumber", "kenyanIdType"]);
const show = (value: unknown, key?: string): string => {
  if (value === null || value === undefined || value === "") return "Not found";
  if (key === "documentType") return DOCUMENT_TYPE_LABELS[String(value)] ?? String(value);
  if (key === "kenyanIdType") return KENYAN_ID_LABELS[String(value)] ?? String(value);
  return String(value);
};
const percent = (score: number | null) => (score === null ? "Not checked" : `${Math.round(score * 100)}%`);

function verdictOf(verification: DocumentReportData["verification"]): { label: string; tone: Tone } {
  if (verification.status === "failed") return { label: "Could not be verified", tone: "red" };
  if (verification.status !== "completed") return { label: "Processing", tone: "neutral" };
  if (verification.verdict === "pass") return { label: "Verified", tone: "green" };
  if (verification.verdict === "reject") return { label: "Rejected", tone: "red" };
  return { label: "Needs review", tone: "amber" };
}

export function documentReportSpec(report: DocumentReportData): ReportSpec {
  const { verification, review, clientName } = report;
  const input = verification.input ?? {};
  const result = verification.result ?? {};
  const flags = result.flags ?? [];
  const identity = result.identity;
  const poa = result.proofOfAddress;
  const kind = result.documentKind ?? input.documentKind;
  const isIdentity = kind !== "proof_of_address" && kind !== "kra_pin";
  const kra = result.kraPin;
  const kindLabel = kind === "proof_of_address" ? "Proof of address" : kind === "kra_pin" ? "KRA PIN certificate" : "Identity document";
  const subject =
    (identity?.fields.fullName as string | undefined) ??
    ([identity?.fields.givenNames, identity?.fields.surname].filter(Boolean).join(" ") || undefined) ??
    poa?.fields.holderName ??
    kra?.fields.taxpayerName ??
    input.expectedName ??
    kindLabel;
  const aiFlags = flags.filter((flag) => /ai_generat|c2pa_ai|visual_ai_generated/.test(flag.code));

  const sections: ReportSection[] = [];
  if (aiFlags.length) sections.push({ heading: "Warning", blocks: [{ kind: "callout", tone: "red", label: "AI-generated document suspected", text: aiFlags.map((flag) => flag.message).join(" ") }] });
  if (result.checks?.length) {
    sections.push({
      heading: "Checks",
      hint: "Every check that ran on this document.",
      blocks: [{ kind: "table", headers: ["Check", "Result", "Detail"], rows: result.checks.map((check) => [check.name, checkLabel(check.status), check.detail ?? ""]), widths: [0.42, 0.16, 0.42], toneColumn: 1, tones: result.checks.map((check) => checkTone(check.status)) }],
    });
  }
  sections.push({
    heading: "Fraud and authenticity findings",
    hint: "From file forensics, the AI visual review, the MRZ, OCR and validation rules.",
    blocks:
      verification.status !== "completed"
        ? [{ kind: "paragraph", text: "Findings appear when processing completes." }]
        : flags.length === 0
          ? [{ kind: "paragraph", text: "No fraud or authenticity issues were found." }]
          : [
              {
                kind: "table",
                headers: ["Severity", "Found by", "Finding"],
                rows: flags.map((flag) => [flag.severity.charAt(0).toUpperCase() + flag.severity.slice(1), SOURCE_LABELS[flag.source] ?? flag.source, flag.message]),
                widths: [0.14, 0.22, 0.64],
                toneColumn: 0,
                tones: flags.map((flag) => SEVERITY_TONE[flag.severity]),
              },
            ],
  });
  if (identity) {
    sections.push({
      heading: "Extracted data",
      hint: "As printed on the document.",
      blocks: [
        {
          kind: "rows",
          rows: [
            ...IDENTITY_FIELDS.filter(([key]) => !OPTIONAL_FIELDS.has(key) || identity.fields[key]).map(([key, label]) => [label, show(identity.fields[key], key)] as [string, string]),
            ["Age", identity.age === null ? "Not found" : `${identity.age} (${identity.isAdult ? "adult, 18+" : "under 18"})`],
            ["Holder photo", identity.fields.hasFacePhoto ? "Present" : "Not found"],
            ["Signature", identity.fields.hasSignature ? "Present" : "Not found"],
            ...(identity.expectedNameMatch !== null ? ([["Matches declared name", percent(identity.expectedNameMatch)]] as Array<[string, string]>) : []),
            ...(identity.expectedDateOfBirthMatch !== null ? ([["Matches declared date of birth", identity.expectedDateOfBirthMatch ? "Yes" : "No"]] as Array<[string, string]>) : []),
          ],
        },
      ],
    });
  }
  if (identity?.mrz) {
    const mrz = identity.mrz;
    sections.push({
      heading: "Machine-readable zone",
      hint: `${mrz.format} format, decoded and validated.`,
      blocks: [
        {
          kind: "rows",
          mono: ["MRZ"],
          rows: [
            ...((identity.fields.mrzLines ?? []).length ? ([["MRZ", (identity.fields.mrzLines ?? []).join("\n")]] as Array<[string, string]>) : []),
            ["Document number", mrz.documentNumber],
            ["Name", `${mrz.givenNames} ${mrz.surname}`.trim()],
            ["Date of birth", show(mrz.birthDate)],
            ["Expiry date", show(mrz.expiryDate)],
            ["Nationality / issuer", `${mrz.nationality} / ${mrz.issuingCountry}`],
            ["Check digits", mrz.checks.map((check) => `${check.name} ${check.valid ? "valid" : "INVALID"}`).join(", ")],
          ],
        },
      ],
    });
  }
  if (kra) {
    sections.push({
      heading: "KRA PIN certificate",
      hint: "Read from the certificate and checked against the KRA PIN format and the customer's details.",
      blocks: [
        {
          kind: "rows",
          rows: [
            ["KRA PIN", show(kra.fields.pin)],
            ["Taxpayer", show(kra.fields.taxpayerName)],
            ["Taxpayer type", kra.fields.taxpayerType === "individual" ? "Individual" : kra.fields.taxpayerType === "non_individual" ? "Company or other non-individual" : "-"],
            ["Email on the certificate", show(kra.fields.email)],
            ["Certificate date", show(kra.fields.certificateDate)],
            ["Tax obligations", kra.fields.obligations.length ? kra.fields.obligations.join("; ") : "-"],
            ["Declared name", input.expectedName ?? "Not provided"],
            ["Name match", percent(kra.nameMatch)],
            ["KRA records", kra.registry ? kra.registry.message : "Not checked with KRA"],
          ],
        },
      ],
    });
  }
  if (poa) {
    sections.push({
      heading: "Proof of address",
      hint: "Extracted from the document and matched against the customer's details.",
      blocks: [
        {
          kind: "rows",
          rows: [
            ["Document type", poa.fields.documentType.replace(/_/g, " ")],
            ["Issued by", show(poa.fields.issuerName)],
            ["Account holder", show(poa.fields.holderName)],
            ["Address", show(poa.fields.address)],
            ["Issue date", `${show(poa.fields.issueDate)}${poa.documentAgeDays !== null ? ` (${poa.documentAgeDays} days old; limit ${poa.maxDocumentAgeDays})` : ""}`],
            ["Account reference", show(poa.fields.accountReference)],
            ["Declared name", input.expectedName ?? "Not provided"],
            ["Name match", percent(poa.nameMatch)],
            ["Declared address", input.expectedAddress ?? "Not provided"],
            ["Address match", percent(poa.addressMatch)],
          ],
        },
      ],
    });
  }
  if (result.vision) sections.push({ heading: "AI visual review", hint: `Forensic review of the image by ${result.vision.model}.`, blocks: [{ kind: "paragraph", text: result.vision.summary || "No issues described." }] });

  sections.push({
    heading: "How this document was checked",
    blocks: [
      {
        kind: "rows",
        rows: [
          [
            "File forensics",
            result.forensics?.metadataAvailable === false
              ? "Limited: the image was resized before upload, so its original metadata wasn't available."
              : `Checked ${result.forensics?.fileTypes.join(", ").toUpperCase() ?? "file"} metadata for AI generators, editing software, content credentials and PDF edits.${result.forensics?.software.length ? ` Software recorded in the file: ${result.forensics.software.join(", ")}.` : ""}`,
          ],
          [
            "OCR cross-check",
            result.ocr?.status === "checked"
              ? `AWS Textract read the document independently${result.ocr.averageConfidence !== null ? ` (${result.ocr.averageConfidence}% average confidence)` : ""}; ${result.ocr.checked.length - result.ocr.missing.length} of ${result.ocr.checked.length} values confirmed.`
              : result.ocr?.status === "not_configured"
                ? "Not run: AWS Textract is not configured."
                : result.ocr?.status === "unavailable"
                  ? "Not run: AWS Textract was unavailable."
                  : result.ocr?.status === "unsupported_file"
                    ? "Not run: this file type isn't supported by AWS Textract."
                    : "-",
          ],
          [
            "Content credentials (C2PA)",
            result.contentCredentials?.status === "checked"
              ? result.contentCredentials.matches
                ? `${result.contentCredentials.matches} registered credential(s) matched.`
                : "No registered credential matched."
              : "Registry lookup not available; embedded credentials are checked under file forensics.",
          ],
          ["Pages submitted", input.pages ?? 1],
        ],
      },
    ],
  });

  const reviewBlocks: ReportBlock[] = review
    ? [
        {
          kind: "rows",
          rows: [
            ["Status", review.status === "resolved" ? (review.resolutionAction === "confirm" ? "Resolved - cleared by the reviewer" : "Resolved - finding confirmed") : review.status === "in_review" ? "Escalated - under investigation" : "Awaiting review"],
            ["Opened", dateTime(review.createdAt)],
            ["Why it was held", review.triggerReason],
            ...(review.resolvedAt ? ([["Resolved", `${dateTime(review.resolvedAt)}${review.resolvedByName ? ` by ${review.resolvedByName}` : ""}`]] as Array<[string, string]>) : []),
            ...(review.resolutionNotes ? ([["Reviewer notes", review.resolutionNotes]] as Array<[string, string]>) : []),
          ],
        },
      ]
    : [{ kind: "paragraph", text: verification.verdict === "pass" ? "No review was needed." : "No review item is recorded." }];
  if (verification.verdict && verification.verdict !== "pass") reviewBlocks.push(REVIEW_SIGNATURES);
  if (result.fraudNetwork) sections.push({ heading: FRAUD_NETWORK_HEADING, hint: FRAUD_NETWORK_HINT, blocks: [{ kind: "rows", rows: fraudNetworkRows(result.fraudNetwork) }] });
  sections.push({ heading: "Review", blocks: reviewBlocks });
  sections.push({
    heading: "About this report",
    blocks: [{ kind: "paragraph", small: true, text: "Findings are leads for review, not proof of fraud. AI reading can misread poor images; confirm against the original document before acting. Sentinel does not store the document images." }],
  });

  return {
    title: kind === "kra_pin" ? "KRA PIN Certificate Report" : isIdentity ? "Identity Document Report" : "Proof of Address Report",
    reference: verification.reference,
    organization: clientName,
    eyebrow: `${kindLabel} verification${clientName ? ` - ${clientName}` : ""}`,
    subject,
    verdict: verdictOf(verification),
    summary: verification.failureReason ?? result.reason ?? null,
    facts: [
      ["Fraud risk score", typeof result.riskScore === "number" ? `${result.riskScore} / 100` : "-"],
      ["Submitted", dateTime(verification.createdAt)],
      ["Completed", dateTime(verification.completedAt)],
      ["Your reference", input.externalRef ?? "-"],
    ],
    sections,
    fileName: `${kind === "kra_pin" ? "KRA-PIN" : isIdentity ? "ID-document" : "Proof-of-address"}-report-${verification.reference}.pdf`,
  };
}
