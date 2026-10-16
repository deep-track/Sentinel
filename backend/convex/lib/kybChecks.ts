import type Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { documentVerdict, isIsoDate, nameMatchScore, type FraudFlag } from "./documentChecks";
import {
  DOCUMENT_VISION_MODEL,
  DocumentVisionError,
  FRAUD_SCHEMA,
  SHARED_RULES,
  imageBlocks,
  nullableString,
  signalsToFlags,
  type DocumentImage,
  type VisionResult,
} from "./documentVision";

// KYB (business verification) checks: reading the registration certificate
// with Claude vision and matching it to what the client declared, and the
// overall decision from the certificate, proof of address and the AML
// screening of the business and each director / beneficial owner.

export const BUSINESS_DOCUMENT_TYPES = [
  "certificate_of_incorporation",
  "certificate_of_registration",
  "business_name_certificate",
  "cr12",
  "other",
] as const;
export type BusinessDocumentType = (typeof BUSINESS_DOCUMENT_TYPES)[number];

export type BusinessRegistrationFields = {
  documentType: BusinessDocumentType;
  companyName: string | null;
  registrationNumber: string | null;
  incorporationDate: string | null;
  jurisdiction: string | null;
  issuingAuthority: string | null;
  directors: string[];
};

const BUSINESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isBusinessRegistrationDocument", "fields", "fraud"],
  properties: {
    isBusinessRegistrationDocument: { type: "boolean" },
    fields: {
      type: "object",
      additionalProperties: false,
      required: ["documentType", "companyName", "registrationNumber", "incorporationDate", "jurisdiction", "issuingAuthority", "directors"],
      properties: {
        documentType: { type: "string", enum: [...BUSINESS_DOCUMENT_TYPES] },
        companyName: nullableString,
        registrationNumber: nullableString,
        incorporationDate: nullableString,
        jurisdiction: nullableString,
        issuingAuthority: nullableString,
        directors: { type: "array", items: { type: "string" } },
      },
    },
    fraud: FRAUD_SCHEMA,
  },
} as const;

const BUSINESS_PROMPT = `${SHARED_RULES}

The document should be a company registration document: a certificate of incorporation or registration, a business name certificate, or a CR12 (Kenya's official search showing directors and shareholders), or the equivalent from another country. Set isBusinessRegistrationDocument false if it is not. Extract the registered name exactly as printed, the registration or company number, the date of incorporation or registration, the jurisdiction (country), the issuing authority (e.g. Registrar of Companies, Business Registration Service), and the names of any directors or officers listed (empty list if none are listed).`;

export async function readBusinessRegistration(client: Anthropic, images: DocumentImage[]): Promise<VisionResult<BusinessRegistrationFields>> {
  const response = await client.beta.messages.parse({
    model: DOCUMENT_VISION_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(BUSINESS_SCHEMA) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: BUSINESS_PROMPT,
    messages: [{ role: "user", content: [...imageBlocks(images), { type: "text", text: "Extract the fields and report any fraud signals." }] }],
  });
  if (response.stop_reason === "refusal") throw new DocumentVisionError("Document reading was declined");
  if (response.stop_reason === "max_tokens") throw new DocumentVisionError("Document reading was cut off");
  if (!response.parsed_output) throw new DocumentVisionError("Document reading returned no structured output");
  const raw = response.parsed_output as {
    isBusinessRegistrationDocument: boolean;
    fields: BusinessRegistrationFields;
    fraud: { signals: VisionResult<unknown>["signals"]; summary: string };
  };
  const flags = signalsToFlags(raw.fraud.signals);
  if (!raw.isBusinessRegistrationDocument) {
    flags.push({ code: "not_a_registration_document", severity: "critical", source: "vision", message: "The document is not a company registration document." });
  }
  return {
    fields: { ...raw.fields, directors: raw.fields.directors.slice(0, 50).map((name) => name.slice(0, 200)) },
    isExpectedDocument: raw.isBusinessRegistrationDocument,
    flags,
    signals: raw.fraud.signals,
    summary: raw.fraud.summary.slice(0, 1000),
    model: DOCUMENT_VISION_MODEL,
  };
}

// "ACME (KENYA) LTD." and "Acme Kenya Limited" are the same name.
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[().,&'-]/g, " ")
    .replace(/\bltd\b/g, "limited")
    .replace(/\bplc\b/g, "public limited company")
    .replace(/\bco\b/g, "company")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type CertificateCheck = { name: string; status: "passed" | "failed" | "not_applicable"; detail?: string };

// Matches the certificate to what the client declared.
export function certificateRules(
  fields: BusinessRegistrationFields,
  declared: { businessName: string; registrationNumber: string; directors: string[] },
  now = Date.now(),
): { flags: FraudFlag[]; checks: CertificateCheck[]; nameMatch: number | null } {
  const flags: FraudFlag[] = [];
  const checks: CertificateCheck[] = [];
  const nameMatch = fields.companyName ? nameMatchScore(normalizeCompanyName(declared.businessName), normalizeCompanyName(fields.companyName)) : null;
  if (nameMatch === null) {
    flags.push({ code: "business_name_unreadable", severity: "medium", source: "rules", message: "The registered name couldn't be read on the certificate." });
  } else if (nameMatch < 0.8) {
    flags.push({ code: "business_name_mismatch", severity: "high", source: "rules", message: `The certificate is for "${fields.companyName}", not "${declared.businessName}".` });
  }
  checks.push({ name: "Registered name matches", status: nameMatch === null ? "not_applicable" : nameMatch >= 0.8 ? "passed" : "failed", detail: fields.companyName ?? undefined });

  const numberMatch = fields.registrationNumber ? normalizeRegistrationNumber(fields.registrationNumber) === normalizeRegistrationNumber(declared.registrationNumber) : null;
  if (numberMatch === null) {
    flags.push({ code: "registration_number_unreadable", severity: "medium", source: "rules", message: "The registration number couldn't be read on the certificate." });
  } else if (!numberMatch) {
    flags.push({ code: "registration_number_mismatch", severity: "high", source: "rules", message: `The certificate shows registration number ${fields.registrationNumber}, not ${declared.registrationNumber}.` });
  }
  checks.push({ name: "Registration number matches", status: numberMatch === null ? "not_applicable" : numberMatch ? "passed" : "failed", detail: fields.registrationNumber ?? undefined });

  if (isIsoDate(fields.incorporationDate) && Date.parse(`${fields.incorporationDate}T00:00:00Z`) > now) {
    flags.push({ code: "incorporation_date_in_future", severity: "critical", source: "rules", message: "The incorporation date is in the future." });
  }

  // A certificate that lists directors (e.g. a CR12) should list the ones
  // the client declared.
  if (fields.directors.length > 0) {
    const missing = declared.directors.filter((name) => !fields.directors.some((listed) => nameMatchScore(name, listed) >= 0.67));
    if (missing.length > 0) {
      flags.push({ code: "director_not_on_document", severity: "medium", source: "rules", message: `Not listed on the document: ${missing.slice(0, 5).join(", ")}.` });
    }
    checks.push({ name: "Declared directors are on the document", status: missing.length ? "failed" : "passed", detail: `${declared.directors.length - missing.length}/${declared.directors.length} found` });
  }
  return { flags, checks, nameMatch };
}

export type PartyOutcome = { name: string; role: "business" | "director" | "ubo" | "shareholder"; verdict: "pass" | "review" | "reject"; complete: boolean; reason: string };
export type ComponentOutcome = { verdict: "pass" | "review" | "reject" | "unavailable"; reason: string };

// The overall KYB verdict. Any rejection (a strong sanctions match, a forged
// or impossible certificate) rejects; anything held, unreadable or
// unavailable goes to review; only an all-clear passes.
// registry is the company-register lookup (Kenya BRS), when it applies.
export function decideKyb(params: { certificate: ComponentOutcome; proofOfAddress: ComponentOutcome; parties: PartyOutcome[]; registry?: ComponentOutcome }): {
  verdict: "pass" | "review" | "reject";
  reason: string;
  complete: boolean;
} {
  const { certificate, proofOfAddress, parties, registry } = params;
  const issues: string[] = [];
  let verdict: "pass" | "review" | "reject" = "pass";
  const raise = (to: "review" | "reject") => {
    if (to === "reject" || verdict === "pass") verdict = to;
  };
  for (const [label, component] of [
    ["Registration certificate", certificate],
    ["Proof of address", proofOfAddress],
    ...(registry ? ([["Company registry", registry]] as const) : []),
  ] as const) {
    if (component.verdict === "pass") continue;
    raise(component.verdict === "reject" ? "reject" : "review");
    issues.push(`${label}: ${component.verdict === "unavailable" ? "couldn't be checked automatically" : component.reason}`);
  }
  for (const party of parties) {
    if (party.verdict === "pass" && party.complete) continue;
    raise(party.verdict === "reject" ? "reject" : "review");
    issues.push(`${party.role === "business" ? "The business" : party.name} (${party.role === "business" ? "AML" : `${party.role === "ubo" ? "beneficial owner" : party.role}, AML`}): ${party.complete ? party.reason : "screening incomplete"}`);
  }
  const complete =
    certificate.verdict !== "unavailable" && proofOfAddress.verdict !== "unavailable" && registry?.verdict !== "unavailable" && parties.every((party) => party.complete);
  const reason =
    verdict === "pass"
      ? `Business verified: the registration certificate matches${registry ? " the company register" : ""}, proof of address passed, and the business and ${parties.length - 1} director${parties.length - 1 === 1 ? "" : "s"} / owner${parties.length - 1 === 1 ? "" : "s"} were screened with no hits.`
      : `${verdict === "reject" ? "Business rejected" : "Business needs review"}: ${issues.slice(0, 6).join(" ")}`;
  return { verdict, reason: reason.slice(0, 2000), complete };
}

export function certificateVerdict(flags: FraudFlag[]): ComponentOutcome {
  const { verdict } = documentVerdict(flags);
  const top = flags.find((flag) => flag.severity === "critical") ?? flags.find((flag) => flag.severity === "high") ?? flags[0];
  return { verdict, reason: verdict === "pass" ? "Matches the declared business." : top?.message ?? "Needs a closer look." };
}

// Uploaded KYB documents live on UploadThing; only those hosts are fetched.
export function isAllowedDocumentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "utfs.io" || host.endsWith(".utfs.io") || host.endsWith(".ufs.sh") || host === "uploadthing.com" || host.endsWith(".uploadthing.com");
  } catch {
    return false;
  }
}
