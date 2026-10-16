"use client";

import { FraudNetworkDetail } from "@/components/risk/fraud-network";
import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";
import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { ReportPdfButton } from "@/components/reports/report-pdf-button";
import { documentReportSpec, type DocumentReportData } from "@/components/reports/document-report-spec";

type Flag = { code: string; severity: "critical" | "high" | "medium" | "low"; source: "file" | "mrz" | "rules" | "vision" | "ocr"; message: string };
type Check = { name: string; status: "passed" | "failed" | "not_applicable"; detail?: string };
type Mrz = {
  format: string;
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  birthDate: string | null;
  expiryDate: string | null;
  sex: string;
  surname: string;
  givenNames: string;
  checks: Array<{ name: string; valid: boolean }>;
};

type Result = {
  fraudNetwork?: NetworkSummary;
  reason?: string;
  riskScore?: number;
  sandbox?: boolean;
  documentKind?: "identity" | "proof_of_address" | "kra_pin";
  flags?: Flag[];
  checks?: Check[];
  identity?: {
    fields: Record<string, unknown> & { mrzLines?: string[]; hasFacePhoto?: boolean; hasSignature?: boolean; documentType?: string };
    mrz: Mrz | null;
    age: number | null;
    isAdult: boolean | null;
    isExpired: boolean | null;
    expectedNameMatch: number | null;
    expectedDateOfBirthMatch: boolean | null;
  };
  kraPin?: {
    fields: { pin: string | null; taxpayerName: string | null; taxpayerType: "individual" | "non_individual" | null; email: string | null; certificateDate: string | null; obligations: string[]; issuedByKra: boolean };
    nameMatch: number | null;
  };
  proofOfAddress?: {
    fields: { documentType: string; issuerName: string | null; holderName: string | null; address: string | null; issueDate: string | null; accountReference: string | null };
    nameMatch: number | null;
    addressMatch: number | null;
    documentAgeDays: number | null;
    maxDocumentAgeDays: number;
  };
  forensics?: { fileTypes: string[]; software: string[]; metadataAvailable?: boolean };
  vision?: { model: string; summary: string; signals: Array<{ signal: string; confidence: string; evidence: string }> };
  ocr?: { status: string; provider: string | null; averageConfidence: number | null; checked: string[]; missing: string[] };
  contentCredentials?: {
    status: string;
    matches: number;
    findings: Array<{ manifestId: string; similarityScore: number | null; digitalSourceType: string; claimGenerator: string | null; edited: boolean }>;
  };
};

type Report = {
  verification: {
    _id: string;
    reference: string;
    status: "queued" | "processing" | "completed" | "failed";
    verdict?: "pass" | "review" | "reject";
    failureReason?: string;
    createdAt: number;
    completedAt?: number;
    input?: { documentKind?: string; pages?: number; expectedName?: string | null; expectedAddress?: string | null; expectedDateOfBirth?: string | null; externalRef?: string | null; resized?: boolean } | null;
    result?: Result | null;
  };
  clientName: string | null;
  review: {
    status: "pending" | "in_review" | "resolved";
    priority: string;
    triggerReason: string;
    createdAt: number;
    resolutionAction: "confirm" | "keep_verdict" | "escalate" | null;
    resolutionNotes: string | null;
    resolvedAt: number | null;
    resolvedByName: string | null;
  } | null;
};

const SOURCE_LABELS: Record<Flag["source"], string> = {
  file: "File forensics",
  mrz: "Machine-readable zone",
  rules: "Validation rules",
  vision: "AI visual review",
  ocr: "OCR cross-check",
};

const SEVERITY_STYLE: Record<Flag["severity"], string> = {
  critical: "border-red-300 bg-red-50 text-red-700",
  high: "border-orange-300 bg-orange-50 text-orange-700",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-slate-300 bg-slate-50 text-slate-600",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ai_generated: "AI-generated",
  ai_composite: "Partly AI-generated",
  digital_capture: "Camera capture",
  other: "Other source",
  unknown: "Source not stated",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  national_id: "National ID card",
  drivers_licence: "Driver's licence",
  residence_permit: "Residence permit",
  other: "Other",
};

const IDENTITY_FIELDS: Array<[string, string]> = [
  ["documentType", "Document type"],
  ["issuingCountry", "Issuing country"],
  ["documentNumber", "Document number"],
  ["fullName", "Full name"],
  ["surname", "Surname"],
  ["givenNames", "Given names"],
  ["dateOfBirth", "Date of birth"],
  ["sex", "Sex"],
  ["nationality", "Nationality"],
  ["placeOfBirth", "Place of birth"],
  ["issueDate", "Issue date"],
  ["expiryDate", "Expiry date"],
  ["issuingAuthority", "Issuing authority"],
  ["personalNumber", "Personal number"],
  ["serialNumber", "Serial number"],
  ["kenyanIdType", "Kenyan ID card"],
  ["address", "Address"],
];

function verdictLabel(verification: Report["verification"]) {
  if (verification.status === "failed") return { label: "Could not be verified", tone: "border-red-300 bg-red-50 text-red-700" };
  if (verification.status !== "completed") return { label: "Processing", tone: "border-slate-300 bg-slate-50 text-slate-600" };
  if (verification.verdict === "pass") return { label: "Verified", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" };
  if (verification.verdict === "reject") return { label: "Rejected — fraud or invalid document", tone: "border-red-300 bg-red-50 text-red-700" };
  return { label: "Needs review", tone: "border-amber-300 bg-amber-50 text-amber-800" };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 break-inside-avoid-page dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 text-sm last:border-0 sm:grid-cols-[200px_1fr] dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="break-words text-slate-900 dark:text-slate-100">{children}</span>
    </div>
  );
}

const KENYAN_ID_LABELS: Record<string, string> = { maisha_card: "Maisha card", second_generation: "Second-generation ID" };
// Shown only when the document has them.
const OPTIONAL_FIELDS = new Set(["serialNumber", "kenyanIdType"]);

function value(raw: unknown, key?: string): React.ReactNode {
  if (raw === null || raw === undefined || raw === "") return <span className="text-slate-400">Not found</span>;
  if (key === "documentType") return DOCUMENT_TYPE_LABELS[String(raw)] ?? String(raw);
  if (key === "kenyanIdType") return KENYAN_ID_LABELS[String(raw)] ?? String(raw);
  return String(raw);
}

function percent(score: number | null) {
  return score === null ? "Not checked" : `${Math.round(score * 100)}%`;
}

function CheckRow({ check }: { check: Check }) {
  const tone =
    check.status === "passed" ? "text-emerald-700" : check.status === "failed" ? "text-red-700" : "text-slate-400";
  const mark = check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "–";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span>
        <span className={`mr-2 font-semibold ${tone}`}>{mark}</span>
        {check.name}
        {check.detail ? <span className="block pl-5 text-xs text-slate-500">{check.detail}</span> : null}
      </span>
      <span className={`shrink-0 text-xs ${tone}`}>{check.status === "not_applicable" ? "n/a" : check.status}</span>
    </div>
  );
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DocumentReport({ verificationId }: { verificationId: string }) {
  const report = useAuthedQuery(anyApi.documents.reportForClient, { verificationId }) as Report | null | undefined;

  if (report === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (report === null) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">
        This document verification doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }

  const { verification, review, clientName } = report;
  const input = verification.input ?? {};
  const result = verification.result ?? {};
  const flags = result.flags ?? [];
  const identity = result.identity;
  const poa = result.proofOfAddress;
  const verdict = verdictLabel(verification);
  const kind = result.documentKind ?? input.documentKind;
  const isIdentity = kind !== "proof_of_address" && kind !== "kra_pin";
  const kra = result.kraPin;
  const kindLabel = kind === "proof_of_address" ? "Proof of address" : kind === "kra_pin" ? "KRA PIN certificate" : "Identity document";
  const aiFlags = flags.filter((flag) => /ai_generat|c2pa_ai|visual_ai_generated/.test(flag.code));
  const title =
    (identity?.fields.fullName as string | undefined) ??
    ([identity?.fields.givenNames, identity?.fields.surname].filter(Boolean).join(" ") || undefined) ??
    poa?.fields.holderName ??
    kra?.fields.taxpayerName ??
    input.expectedName ??
    kindLabel;
  const generatedAt = Date.now();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/idp" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" /> Back to IDP
        </Link>
        <div className="flex flex-wrap gap-2">
          <ReportPdfButton spec={documentReportSpec(report as DocumentReportData)} />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              downloadFile(
                `idp-report-${verification.reference}.json`,
                JSON.stringify({ generatedAt: new Date(generatedAt).toISOString(), ...report }, null, 2),
                "application/json",
              )
            }
          >
            <FileJson className="mr-2 h-4 w-4" /> Evidence (JSON)
          </Button>
        </div>
      </div>

      <header className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {`${kindLabel} report`}
          {clientName ? ` · ${clientName}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{verification.reference}</p>
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-lg border px-3 py-1.5 text-sm font-semibold ${verdict.tone}`}>{verdict.label}</span>
            {typeof result.riskScore === "number" ? <p className="mt-1 text-xs text-slate-500">Fraud risk score {result.riskScore} / 100</p> : null}
          </div>
        </div>
        {result.reason ? <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">{result.reason}</p> : null}
        {verification.failureReason ? <p className="mt-4 text-sm text-red-700">{verification.failureReason}</p> : null}
        {aiFlags.length ? (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-700">
            AI-generated document suspected: {aiFlags.map((flag) => flag.message).join(" ")}
          </p>
        ) : null}
        <p className="mt-4 text-xs text-slate-500">
          Submitted <ClientDate value={verification.createdAt} format="PPpp" />
          {verification.completedAt ? (
            <>
              {" "}· completed <ClientDate value={verification.completedAt} format="PPpp" />
            </>
          ) : null}{" "}
          · report generated <ClientDate value={generatedAt} format="PPpp" />
          {input.externalRef ? ` · your reference ${input.externalRef}` : ""}
        </p>
      </header>

      {result.checks?.length ? (
        <Section title="Checks" hint="Every check that ran on this document.">
          {result.checks.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </Section>
      ) : null}

      {result.fraudNetwork ? (
        <Section title="Fraud network" hint="The document and ID numbers compared, as keyed fingerprints, with earlier checks for reuse by another person or in a fraud rejection.">
          <FraudNetworkDetail summary={result.fraudNetwork} />
        </Section>
      ) : null}

      <Section title="Fraud and authenticity findings" hint="From file forensics, the AI visual review, the MRZ, OCR and validation rules.">
        {verification.status !== "completed" ? (
          <p className="text-sm text-slate-500">Findings appear when processing completes.</p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-emerald-700">No fraud or authenticity issues were found.</p>
        ) : (
          <div className="space-y-2">
            {flags.map((flag) => (
              <div key={flag.code} className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLE[flag.severity]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{flag.severity}</span>
                  <span className="text-xs">{SOURCE_LABELS[flag.source]}</span>
                </div>
                <p className="mt-1">{flag.message}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {identity ? (
        <Section title="Extracted data" hint="As printed on the document.">
          {IDENTITY_FIELDS.filter(([key]) => !OPTIONAL_FIELDS.has(key) || identity.fields[key]).map(([key, label]) => (
            <Row key={key} label={label}>
              {value(identity.fields[key], key)}
            </Row>
          ))}
          <Row label="Age">
            {identity.age === null ? value(null) : `${identity.age} (${identity.isAdult ? "adult, 18+" : "under 18"})`}
          </Row>
          <Row label="Holder photo">{identity.fields.hasFacePhoto ? "Present" : "Not found"}</Row>
          <Row label="Signature">{identity.fields.hasSignature ? "Present" : "Not found"}</Row>
          {identity.expectedNameMatch !== null ? <Row label="Matches declared name">{percent(identity.expectedNameMatch)}</Row> : null}
          {identity.expectedDateOfBirthMatch !== null ? (
            <Row label="Matches declared date of birth">{identity.expectedDateOfBirthMatch ? "Yes" : "No"}</Row>
          ) : null}
        </Section>
      ) : null}

      {identity?.mrz ? (
        <Section title="Machine-readable zone" hint={`${identity.mrz.format} format, decoded and validated.`}>
          <pre className="mb-3 overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-xs dark:bg-slate-800">
            {(identity.fields.mrzLines ?? []).join("\n")}
          </pre>
          <Row label="Document number">{identity.mrz.documentNumber}</Row>
          <Row label="Name">{`${identity.mrz.givenNames} ${identity.mrz.surname}`.trim()}</Row>
          <Row label="Date of birth">{value(identity.mrz.birthDate)}</Row>
          <Row label="Expiry date">{value(identity.mrz.expiryDate)}</Row>
          <Row label="Nationality / issuer">{`${identity.mrz.nationality} / ${identity.mrz.issuingCountry}`}</Row>
          <Row label="Check digits">
            {identity.mrz.checks.map((check) => `${check.name} ${check.valid ? "✓" : "✗"}`).join(" · ")}
          </Row>
        </Section>
      ) : null}

      {kra ? (
        <Section title="KRA PIN certificate" hint="Read from the certificate and checked against the KRA PIN format and the customer's details.">
          <Row label="KRA PIN">{value(kra.fields.pin)}</Row>
          <Row label="Taxpayer">{value(kra.fields.taxpayerName)}</Row>
          <Row label="Taxpayer type">{kra.fields.taxpayerType === "individual" ? "Individual" : kra.fields.taxpayerType === "non_individual" ? "Company or other non-individual" : value(null)}</Row>
          <Row label="Email on the certificate">{value(kra.fields.email)}</Row>
          <Row label="Certificate date">{value(kra.fields.certificateDate)}</Row>
          <Row label="Tax obligations">{kra.fields.obligations.length ? kra.fields.obligations.join("; ") : value(null)}</Row>
          <Row label="Declared name">{input.expectedName ?? "Not provided"}</Row>
          <Row label="Name match">{percent(kra.nameMatch)}</Row>
        </Section>
      ) : null}

      {poa ? (
        <Section title="Proof of address" hint="Extracted from the document and matched against the customer's details.">
          <Row label="Document type">{poa.fields.documentType.replace(/_/g, " ")}</Row>
          <Row label="Issued by">{value(poa.fields.issuerName)}</Row>
          <Row label="Account holder">{value(poa.fields.holderName)}</Row>
          <Row label="Address">{value(poa.fields.address)}</Row>
          <Row label="Issue date">
            {value(poa.fields.issueDate)}
            {poa.documentAgeDays !== null ? ` (${poa.documentAgeDays} days old; limit ${poa.maxDocumentAgeDays})` : ""}
          </Row>
          <Row label="Account reference">{value(poa.fields.accountReference)}</Row>
          <Row label="Declared name">{input.expectedName ?? "Not provided"}</Row>
          <Row label="Name match">{percent(poa.nameMatch)}</Row>
          <Row label="Declared address">{input.expectedAddress ?? "Not provided"}</Row>
          <Row label="Address match">{percent(poa.addressMatch)}</Row>
        </Section>
      ) : null}

      {result.vision ? (
        <Section title="AI visual review" hint={`Forensic review of the image by ${result.vision.model}.`}>
          <p className="text-sm text-slate-700 dark:text-slate-300">{result.vision.summary || "No issues described."}</p>
        </Section>
      ) : null}

      <Section title="How this document was checked">
        <Row label="File forensics">
          {result.forensics?.metadataAvailable === false
            ? "Limited: the image was resized before upload, so its original metadata wasn't available."
            : `Checked ${result.forensics?.fileTypes.join(", ").toUpperCase() ?? "file"} metadata for AI generators, editing software, content credentials and PDF edits.`}
          {result.forensics?.software.length ? ` Software recorded in the file: ${result.forensics.software.join(", ")}.` : ""}
        </Row>
        <Row label="OCR cross-check">
          {result.ocr?.status === "checked"
            ? `AWS Textract read the document independently${result.ocr.averageConfidence !== null ? ` (${result.ocr.averageConfidence}% average confidence)` : ""}; ${result.ocr.checked.length - result.ocr.missing.length} of ${result.ocr.checked.length} values confirmed.`
            : result.ocr?.status === "not_configured"
              ? "Not run: AWS Textract is not configured."
              : result.ocr?.status === "unsupported_file"
                ? "Not run: WebP files aren't supported by AWS Textract."
                : result.ocr?.status === "unavailable"
                  ? "Not run: AWS Textract was unavailable."
                  : "—"}
        </Row>
        <Row label="Content credentials (C2PA)">
          {result.contentCredentials?.status === "checked"
            ? result.contentCredentials.matches
              ? result.contentCredentials.findings
                  .map(
                    (finding) =>
                      `${SOURCE_TYPE_LABELS[finding.digitalSourceType] ?? finding.digitalSourceType}${finding.claimGenerator ? ` by ${finding.claimGenerator}` : ""}${finding.edited ? ", edited" : ""}${finding.similarityScore !== null ? ` (${finding.similarityScore}% match)` : ""}`,
                  )
                  .join("; ") || `${result.contentCredentials.matches} registered credential(s) matched`
              : "Looked up by watermark and fingerprint in a C2PA registry: no registered credential matched."
            : result.contentCredentials?.status === "unavailable"
              ? "Registry lookup was unavailable."
              : result.contentCredentials?.status === "unsupported_file"
                ? "The registry doesn't accept this file type."
                : "Registry lookup not configured. Embedded credentials are still checked under file forensics."}
        </Row>
        <Row label="Pages submitted">{input.pages ?? 1}</Row>
      </Section>

      <Section title="Review">
        {review ? (
          <>
            <Row label="Status">
              {review.status === "resolved"
                ? review.resolutionAction === "confirm"
                  ? "Resolved — cleared by the reviewer"
                  : "Resolved — finding confirmed"
                : review.status === "in_review"
                  ? "Escalated — under investigation"
                  : "Awaiting review"}
            </Row>
            <Row label="Opened">
              <ClientDate value={review.createdAt} format="PPpp" />
            </Row>
            <Row label="Why it was held">{review.triggerReason}</Row>
            {review.resolvedAt ? (
              <Row label="Resolved">
                <ClientDate value={review.resolvedAt} format="PPpp" />
                {review.resolvedByName ? ` by ${review.resolvedByName}` : ""}
              </Row>
            ) : null}
            {review.resolutionNotes ? <Row label="Reviewer notes">{review.resolutionNotes}</Row> : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">{verification.verdict === "pass" ? "No review was needed." : "No review item is recorded."}</p>
        )}
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          {["Decision", "Reviewed by", "Date"].map((label) => (
            <div key={label}>
              <p className="text-xs text-slate-500">{label}</p>
              <div className="mt-6 border-b border-slate-400" />
            </div>
          ))}
        </div>
      </Section>

      <p className="text-xs text-slate-500">
        Findings are leads for review, not proof of fraud. AI reading can misread poor images; confirm against the original
        document before acting. Sentinel does not store the document images.
      </p>
    </div>
  );
}
