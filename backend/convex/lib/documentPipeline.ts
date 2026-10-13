// Intelligent Document Processing (IDP): combines the four layers into one
// result. Dependencies (Claude client, OCR) are injected, so the whole
// pipeline can be tested without network access.
//
//   1. File forensics  (documentChecks.fileForensics)  always
//   2. Claude vision   (documentVision)                 extraction + visual fraud review
//   3. OCR cross-check (Amazon Textract, when configured) the AI's values must appear in the OCR text
//   4. Rule checks     (documentChecks)                 MRZ, dates, age, PoA matching

import type Anthropic from "@anthropic-ai/sdk";
import {
  dedupeFlags,
  documentVerdict,
  fileForensics,
  identityRuleChecks,
  MEDIA_TYPES,
  nameMatchScore,
  ocrCrossCheck,
  proofOfAddressChecks,
  type FraudFlag,
  type IdentityFields,
  type Mrz,
  type PoaFields,
} from "./documentChecks";
import { readIdentityDocument, readProofOfAddress, type DocumentImage, type DocumentKind, type VisionResult } from "./documentVision";
import type { C2paManifestFinding, C2paOutcome } from "./c2paResolution";

export type OcrResult = { provider: "aws_textract"; text: string; averageConfidence: number | null; lineCount: number };

export type OcrProvider = (bytes: Uint8Array, kind: "jpeg" | "png" | "pdf") => Promise<OcrResult>;

export type PipelineInput = {
  documentKind: DocumentKind;
  front: Uint8Array;
  back?: Uint8Array;
  expected: { name?: string; address?: string; dateOfBirth?: string };
  maxDocumentAgeDays?: number;
  // The image was re-encoded before upload, so its original metadata is gone.
  resized?: boolean;
  now?: number;
};

// Looks the image up in a C2PA soft binding resolution service.
export type ContentCredentialsLookup = (bytes: Uint8Array, mediaType: string) => Promise<C2paOutcome>;

export type PipelineDeps = {
  client: Anthropic;
  ocr: OcrProvider | null;
  contentCredentials?: ContentCredentialsLookup | null;
  onError?: (stage: string, error: unknown) => void;
};

export type PipelineResult = {
  verdict: "pass" | "review" | "reject";
  riskScore: number;
  reason: string;
  flags: FraudFlag[];
  documentKind: DocumentKind;
  identity?: {
    fields: IdentityFields;
    mrz: Mrz | null;
    age: number | null;
    isAdult: boolean | null;
    isExpired: boolean | null;
    expectedNameMatch: number | null;
    expectedDateOfBirthMatch: boolean | null;
  };
  proofOfAddress?: {
    fields: PoaFields;
    nameMatch: number | null;
    addressMatch: number | null;
    documentAgeDays: number | null;
    maxDocumentAgeDays: number;
  };
  forensics: { fileTypes: string[]; software: string[]; metadataAvailable: boolean };
  vision: { model: string; summary: string; signals: VisionResult<unknown>["signals"] };
  ocr: { status: "checked" | "not_configured" | "unavailable" | "unsupported_file"; provider: string | null; averageConfidence: number | null; checked: string[]; missing: string[] };
  contentCredentials: { status: "checked" | "not_configured" | "unavailable" | "unsupported_file"; matches: number; findings: C2paManifestFinding[] };
  checks: Array<{ name: string; status: "passed" | "failed" | "not_applicable"; detail?: string }>;
};

export class DocumentPipelineError extends Error {}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const CRITICAL_FIRST: Record<FraudFlag["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

function describe(verdict: PipelineResult["verdict"], flags: FraudFlag[], kind: DocumentKind) {
  const label = kind === "identity" ? "Identity document" : "Proof of address";
  if (verdict === "pass") return `${label} verified: no fraud signals and all checks passed.`;
  const top = [...flags].sort((a, b) => CRITICAL_FIRST[a.severity] - CRITICAL_FIRST[b.severity]).slice(0, 3);
  const lead = verdict === "reject" ? `${label} rejected` : `${label} needs review`;
  return `${lead}: ${top.map((flag) => flag.message.replace(/\.$/, "")).join("; ")}.`;
}

export async function runDocumentPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const now = input.now ?? Date.now();
  const pages = [
    { side: "front" as const, bytes: input.front },
    ...(input.back ? [{ side: "back" as const, bytes: input.back }] : []),
  ];

  // 1. File forensics.
  const forensics = pages.map((page) => ({ side: page.side, ...fileForensics(page.bytes) }));
  const flags: FraudFlag[] = forensics.flatMap((page) => page.flags);
  const unsupported = forensics.find((page) => page.kind === "unknown");
  if (unsupported) {
    throw new DocumentPipelineError(`The ${unsupported.side} of the document is not a JPEG, PNG, WebP or PDF file.`);
  }
  const images: DocumentImage[] = forensics.map((page, index) => ({
    side: page.side,
    mediaType: MEDIA_TYPES[page.kind as Exclude<typeof page.kind, "unknown">] as DocumentImage["mediaType"],
    base64: base64(pages[index].bytes),
  }));

  // 2. Claude vision, and 3. OCR, in parallel.
  const visionPromise =
    input.documentKind === "identity" ? readIdentityDocument(deps.client, images) : readProofOfAddress(deps.client, images);
  const ocrPromise: Promise<OcrResult | "not_configured" | "unavailable" | "unsupported_file"> = (async () => {
    if (!deps.ocr) return "not_configured";
    const front = forensics[0];
    if (front.kind === "webp") return "unsupported_file";
    try {
      return await deps.ocr(input.front, front.kind as "jpeg" | "png" | "pdf");
    } catch (error) {
      deps.onError?.("ocr", error);
      return "unavailable";
    }
  })();
  // C2PA soft binding lookup (watermark / fingerprint), in parallel too.
  const c2paPromise: Promise<C2paOutcome> = deps.contentCredentials
    ? deps.contentCredentials(input.front, images[0].mediaType).catch((error) => {
        deps.onError?.("content_credentials", error);
        return { status: "unavailable" as const };
      })
    : Promise.resolve({ status: "not_configured" as const });
  const [vision, ocr, c2pa] = await Promise.all([visionPromise, ocrPromise, c2paPromise]);
  flags.push(...vision.flags);
  if (c2pa.status === "checked") flags.push(...c2pa.flags);

  const checks: PipelineResult["checks"] = [];
  let identity: PipelineResult["identity"];
  let proofOfAddress: PipelineResult["proofOfAddress"];
  let ocrValues: Record<string, string | null | undefined> = {};

  // 4. Rule checks.
  if (input.documentKind === "identity") {
    const fields = vision.fields as IdentityFields;
    const rules = identityRuleChecks(fields, now);
    flags.push(...rules.flags);
    const printedName = fields.fullName ?? [fields.givenNames, fields.surname].filter(Boolean).join(" ");
    const expectedNameMatch = input.expected.name && printedName ? nameMatchScore(input.expected.name, printedName) : null;
    if (expectedNameMatch !== null && expectedNameMatch < 0.67) {
      flags.push({ code: "expected_name_mismatch", severity: "high", source: "rules", message: `The name on the document ("${printedName}") doesn't match "${input.expected.name}".` });
    }
    const expectedDateOfBirthMatch = input.expected.dateOfBirth && fields.dateOfBirth ? input.expected.dateOfBirth === fields.dateOfBirth : null;
    if (expectedDateOfBirthMatch === false) {
      flags.push({ code: "expected_birth_date_mismatch", severity: "high", source: "rules", message: `The date of birth on the document (${fields.dateOfBirth}) doesn't match ${input.expected.dateOfBirth}.` });
    }
    identity = { fields, mrz: rules.mrz, age: rules.age, isAdult: rules.isAdult, isExpired: rules.isExpired, expectedNameMatch, expectedDateOfBirthMatch };
    checks.push(
      { name: "Machine-readable zone", status: rules.mrz ? (rules.mrz.checks.every((check) => check.valid) ? "passed" : "failed") : "not_applicable", detail: rules.mrz ? `${rules.mrz.format}, ${rules.mrz.checks.filter((check) => check.valid).length}/${rules.mrz.checks.length} check digits valid` : "No MRZ on the document" },
      { name: "Not expired", status: rules.isExpired === null ? "not_applicable" : rules.isExpired ? "failed" : "passed", detail: fields.expiryDate ?? undefined },
      { name: `Age ${18}+`, status: rules.isAdult === null ? "not_applicable" : rules.isAdult ? "passed" : "failed", detail: rules.age === null ? undefined : `${rules.age} years old` },
      { name: "Holder photo present", status: fields.hasFacePhoto ? "passed" : "failed" },
      { name: "Signature present", status: fields.hasSignature ? "passed" : "not_applicable" },
    );
    if (expectedNameMatch !== null) checks.push({ name: "Name matches the declared name", status: expectedNameMatch >= 0.67 ? "passed" : "failed" });
    if (expectedDateOfBirthMatch !== null) checks.push({ name: "Date of birth matches", status: expectedDateOfBirthMatch ? "passed" : "failed" });
    ocrValues = { "document number": fields.documentNumber, surname: fields.surname, "date of birth": fields.dateOfBirth, "expiry date": fields.expiryDate };
  } else {
    const fields = vision.fields as PoaFields;
    const maxDocumentAgeDays = input.maxDocumentAgeDays ?? 90;
    const rules = proofOfAddressChecks(fields, { name: input.expected.name, address: input.expected.address }, { maxAgeDays: maxDocumentAgeDays, now });
    flags.push(...rules.flags);
    proofOfAddress = { fields, nameMatch: rules.nameMatch, addressMatch: rules.addressMatch, documentAgeDays: rules.documentAgeDays, maxDocumentAgeDays };
    checks.push(
      { name: "Recognised document type", status: fields.documentType === "other" ? "failed" : "passed", detail: fields.documentType.replace(/_/g, " ") },
      { name: `Issued within ${maxDocumentAgeDays} days`, status: rules.documentAgeDays === null ? "failed" : rules.documentAgeDays >= 0 && rules.documentAgeDays <= maxDocumentAgeDays ? "passed" : "failed", detail: fields.issueDate ?? "No issue date" },
      { name: "Name matches", status: rules.nameMatch === null ? "not_applicable" : rules.nameMatch >= 0.67 ? "passed" : "failed" },
      { name: "Address matches", status: rules.addressMatch === null ? "not_applicable" : rules.addressMatch >= 0.6 ? "passed" : "failed" },
    );
    ocrValues = { "holder name": fields.holderName, "issue date": fields.issueDate, "account reference": fields.accountReference };
  }

  // 3b. OCR cross-check.
  let ocrSummary: PipelineResult["ocr"];
  if (typeof ocr === "object") {
    const cross = ocrCrossCheck(ocr.text, ocrValues);
    ocrSummary = { status: "checked", provider: ocr.provider, averageConfidence: ocr.averageConfidence, checked: cross.checked, missing: cross.missing };
    if (cross.missing.length > 0 && cross.checked.length > 0) {
      const share = cross.missing.length / cross.checked.length;
      flags.push({
        code: "ocr_mismatch",
        severity: share >= 0.5 ? "high" : "medium",
        source: "ocr",
        message: `Independent OCR (AWS Textract) couldn't find the ${cross.missing.join(", ")} the AI read on the document.`,
      });
    }
    checks.push({ name: "OCR agrees with AI reading", status: cross.missing.length ? "failed" : "passed", detail: `${cross.checked.length - cross.missing.length}/${cross.checked.length} values confirmed` });
  } else {
    ocrSummary = { status: ocr, provider: null, averageConfidence: null, checked: [], missing: [] };
  }

  if (c2pa.status === "checked") {
    checks.push({
      name: "No AI or edit record in content credential registries",
      status: c2pa.flags.length ? "failed" : "passed",
      detail: c2pa.matches ? `${c2pa.matches} registered credential${c2pa.matches === 1 ? "" : "s"} matched` : "No registered credential matched",
    });
  }

  const fileFlags = forensics.flatMap((page) => page.flags);
  checks.unshift({
    name: "File metadata clean",
    status: input.resized ? "not_applicable" : fileFlags.some((flag) => flag.severity !== "low") ? "failed" : "passed",
    detail: input.resized ? "The image was resized before upload, so its original metadata wasn't available" : undefined,
  });
  checks.unshift({ name: "No visual fraud signals", status: vision.flags.length ? "failed" : "passed" });

  const finalFlags = dedupeFlags(flags);
  const { verdict, riskScore } = documentVerdict(finalFlags);
  return {
    verdict,
    riskScore,
    reason: describe(verdict, finalFlags, input.documentKind),
    flags: finalFlags,
    documentKind: input.documentKind,
    identity,
    proofOfAddress,
    forensics: {
      fileTypes: forensics.map((page) => page.kind),
      software: [...new Set(forensics.flatMap((page) => page.software))],
      metadataAvailable: !input.resized,
    },
    vision: { model: vision.model, summary: vision.summary, signals: vision.signals },
    ocr: ocrSummary,
    contentCredentials:
      c2pa.status === "checked"
        ? { status: "checked", matches: c2pa.matches, findings: c2pa.findings }
        : { status: c2pa.status, matches: 0, findings: [] },
    checks,
  };
}
