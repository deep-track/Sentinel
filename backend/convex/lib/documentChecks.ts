// Intelligent Document Processing (IDP): the deterministic checks that run on
// every document, alongside the AI reading (documentVision.ts) and the AWS
// Textract OCR cross-check. No imports, so tests can transpile and evaluate
// this file directly.
//
//   File forensics      AI-generator and editing-tool signatures in image
//                       metadata (EXIF/XMP/PNG text), C2PA "AI generated"
//                       content credentials, PDFs edited after creation.
//   MRZ                 parse TD1 (ID cards) and TD3 (passports), validate
//                       every check digit, compare with the printed fields.
//   Dates and age       expiry, issue before expiry, plausible birth date,
//                       age from the date of birth.
//   Proof of address    name and address match against what the customer
//                       declared, and how recent the document is.

export type FlagSeverity = "critical" | "high" | "medium" | "low";

export type FraudFlag = {
  code: string;
  severity: FlagSeverity;
  source: "file" | "mrz" | "rules" | "vision" | "ocr";
  message: string;
};

// ── File forensics ──────────────────────────────────────────────────────────

export type FileKind = "jpeg" | "png" | "webp" | "pdf" | "unknown";

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (ascii(bytes, 0, 5) === "%PDF-") return "pdf";
  return "unknown";
}

export const MEDIA_TYPES: Record<Exclude<FileKind, "unknown">, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let index = start; index < Math.min(bytes.length, start + length); index++) out += String.fromCharCode(bytes[index]);
  return out;
}

// Printable text of a file (latin1), for scanning metadata markers. Big files
// are scanned at the start and the end, where metadata lives.
export function printableText(bytes: Uint8Array, maxBytes = 2_000_000): string {
  const slices =
    bytes.length <= maxBytes ? [bytes] : [bytes.subarray(0, maxBytes / 2), bytes.subarray(bytes.length - maxBytes / 2)];
  let out = "";
  for (const slice of slices) {
    for (let index = 0; index < slice.length; index++) {
      const code = slice[index];
      out += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : code === 0x0a ? "\n" : " ";
    }
  }
  return out;
}

// Generators whose name in a document's metadata means it was made by AI.
const AI_GENERATORS = [
  "midjourney",
  "dall-e",
  "dall·e",
  "dalle",
  "stable diffusion",
  "stablediffusion",
  "sdxl",
  "comfyui",
  "automatic1111",
  "invokeai",
  "novelai",
  "adobe firefly",
  "firefly",
  "generative fill",
  "imagen",
  "gemini",
  "chatgpt",
  "openai",
  "gpt-4o",
  "ideogram",
  "leonardo.ai",
  "flux.1",
  "black forest labs",
  "runway",
  "nightcafe",
  "craiyon",
];

// Image editors and PDF editors: a genuine scan or phone photo of a document
// has no reason to pass through them.
const EDITORS = [
  "photoshop",
  "gimp",
  "canva",
  "pixelmator",
  "affinity photo",
  "affinity designer",
  "paint.net",
  "photopea",
  "lightroom",
  "snapseed",
  "picsart",
  "illustrator",
  "coreldraw",
  "inkscape",
  "ilovepdf",
  "smallpdf",
  "pdfescape",
  "sejda",
  "pdf-xchange editor",
  "foxit phantompdf",
  "foxit pdf editor",
  "nitro pro",
  "pdfelement",
  "adobe acrobat pro",
  "microsoft word",
  "libreoffice",
  "google docs",
];

export function fileForensics(bytes: Uint8Array): { kind: FileKind; flags: FraudFlag[]; software: string[] } {
  const kind = detectFileKind(bytes);
  const flags: FraudFlag[] = [];
  if (kind === "unknown") {
    flags.push({ code: "unsupported_file", severity: "high", source: "file", message: "The file is not a JPEG, PNG, WebP or PDF." });
    return { kind, flags, software: [] };
  }
  const text = printableText(bytes);
  const lower = text.toLowerCase();

  // Software / creator fields: EXIF Software, XMP CreatorTool, PDF Producer and Creator.
  const software = [
    ...new Set(
      [
        ...text.matchAll(/(?:xmp:CreatorTool|tiff:Software|photoshop:History|pdf:Producer)\s*[=>]\s*["']?([^"'<\n]{2,80})/gi),
        ...text.matchAll(/\/(?:Producer|Creator)\s*\(([^)]{2,80})\)/g),
      ].map((match) => match[1].trim()),
    ),
  ].slice(0, 10);

  const ai = AI_GENERATORS.find((name) => lower.includes(name));
  if (ai) {
    flags.push({
      code: "ai_generator_metadata",
      severity: "critical",
      source: "file",
      message: `The file's metadata names an AI image generator (${ai}).`,
    });
  }
  // IPTC digital source type, used by C2PA content credentials and many generators.
  if (/trainedalgorithmicmedia/.test(lower)) {
    flags.push({
      code: "c2pa_ai_generated",
      severity: "critical",
      source: "file",
      message: lower.includes("compositewithtrainedalgorithmicmedia")
        ? "The file's content credentials say it was partly made with generative AI."
        : "The file's content credentials say it was generated by AI.",
    });
  } else if (/c2pa|jumbf/.test(lower)) {
    flags.push({
      code: "c2pa_manifest",
      severity: "low",
      source: "file",
      message: "The file carries content credentials (C2PA); review its edit history.",
    });
  }
  // Stable Diffusion front-ends write their settings into a PNG text chunk.
  if (kind === "png" && /parameters[\s\S]{0,400}(steps:|sampler:|cfg scale:|seed:)/i.test(text)) {
    flags.push({
      code: "ai_generation_parameters",
      severity: "critical",
      source: "file",
      message: "The image contains AI generation settings (steps, sampler, seed).",
    });
  }
  const editor = EDITORS.find((name) => lower.includes(name));
  if (editor && !ai) {
    flags.push({
      code: "edited_with_software",
      severity: "high",
      source: "file",
      message: `The file was saved by editing software (${editor}).`,
    });
  }
  if (kind === "pdf") {
    // Each incremental save appends a new trailer: more than one %%EOF means
    // the PDF was changed after it was first produced.
    const revisions = (text.match(/%%EOF/g) ?? []).length;
    if (revisions > 1) {
      flags.push({
        code: "pdf_modified_after_creation",
        severity: "high",
        source: "file",
        message: `The PDF was changed ${revisions - 1} time${revisions === 2 ? "" : "s"} after it was created.`,
      });
    }
    const created = text.match(/\/CreationDate\s*\(D:(\d{8})/)?.[1];
    const modified = text.match(/\/ModDate\s*\(D:(\d{8})/)?.[1];
    if (created && modified && modified > created) {
      flags.push({
        code: "pdf_modification_date",
        severity: "medium",
        source: "file",
        message: `The PDF's modification date (${pdfDate(modified)}) is later than its creation date (${pdfDate(created)}).`,
      });
    }
  }
  return { kind, flags, software };
}

function pdfDate(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

// ── MRZ ─────────────────────────────────────────────────────────────────────

export type Mrz = {
  format: "TD1" | "TD3";
  documentCode: string;
  issuingCountry: string;
  documentNumber: string;
  nationality: string;
  birthDate: string | null; // YYYY-MM-DD
  sex: "M" | "F" | "X";
  expiryDate: string | null;
  surname: string;
  givenNames: string;
  checks: { name: string; valid: boolean }[];
};

const MRZ_WEIGHTS = [7, 3, 1];

export function mrzCheckDigit(value: string): number {
  let sum = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    let number = 0;
    if (char >= "0" && char <= "9") number = char.charCodeAt(0) - 48;
    else if (char >= "A" && char <= "Z") number = char.charCodeAt(0) - 55;
    sum += number * MRZ_WEIGHTS[index % 3];
  }
  return sum % 10;
}

function checkDigit(value: string, digit: string): boolean {
  if (digit === "<") return /^<*$/.test(value);
  return /^\d$/.test(digit) && mrzCheckDigit(value) === Number(digit);
}

// YYMMDD → YYYY-MM-DD. Birth dates more than 10 years in the future belong to
// the previous century; expiry dates are always this century.
function mrzDate(value: string, kind: "birth" | "expiry", now: number): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const currentYear = new Date(now).getUTCFullYear();
  let year = 2000 + yy;
  if (kind === "birth" && year > currentYear) year -= 100;
  if (kind === "expiry" && year > currentYear + 50) year -= 100;
  return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

function names(field: string) {
  const [surname, ...rest] = field.split("<<");
  return {
    surname: surname.replace(/</g, " ").trim(),
    givenNames: rest.join(" ").replace(/</g, " ").replace(/\s+/g, " ").trim(),
  };
}

function cleanMrzLine(line: string) {
  return line.toUpperCase().replace(/\s+/g, "").replace(/[«‹]/g, "<");
}

// Parses MRZ lines as read off the document. Returns null when they don't
// form a TD1 (3 × 30) or TD3 (2 × 44) zone.
export function parseMrz(lines: string[], now = Date.now()): Mrz | null {
  const clean = lines.map(cleanMrzLine).filter(Boolean);
  if (clean.length === 2 && clean.every((line) => line.length === 44)) {
    const [one, two] = clean;
    const number = two.slice(0, 9);
    const birth = two.slice(13, 19);
    const expiry = two.slice(21, 27);
    const personal = two.slice(28, 42);
    const composite = number + two[9] + birth + two[19] + expiry + two[27] + personal + two[42];
    return {
      format: "TD3",
      documentCode: one.slice(0, 2).replace(/</g, ""),
      issuingCountry: one.slice(2, 5).replace(/</g, ""),
      documentNumber: number.replace(/</g, ""),
      nationality: two.slice(10, 13).replace(/</g, ""),
      birthDate: mrzDate(birth, "birth", now),
      sex: (two[20] === "M" || two[20] === "F" ? two[20] : "X") as Mrz["sex"],
      expiryDate: mrzDate(expiry, "expiry", now),
      ...names(one.slice(5)),
      checks: [
        { name: "document number", valid: checkDigit(number, two[9]) },
        { name: "date of birth", valid: checkDigit(birth, two[19]) },
        { name: "expiry date", valid: checkDigit(expiry, two[27]) },
        { name: "personal number", valid: checkDigit(personal, two[42]) },
        { name: "composite", valid: checkDigit(composite, two[43]) },
      ],
    };
  }
  if (clean.length === 3 && clean.every((line) => line.length === 30)) {
    const [one, two, three] = clean;
    const number = one.slice(5, 14);
    const birth = two.slice(0, 6);
    const expiry = two.slice(8, 14);
    const composite = one.slice(5, 30) + two.slice(0, 7) + two.slice(8, 15) + two.slice(18, 29);
    return {
      format: "TD1",
      documentCode: one.slice(0, 2).replace(/</g, ""),
      issuingCountry: one.slice(2, 5).replace(/</g, ""),
      documentNumber: number.replace(/</g, ""),
      nationality: two.slice(15, 18).replace(/</g, ""),
      birthDate: mrzDate(birth, "birth", now),
      sex: (two[7] === "M" || two[7] === "F" ? two[7] : "X") as Mrz["sex"],
      expiryDate: mrzDate(expiry, "expiry", now),
      ...names(three),
      checks: [
        { name: "document number", valid: checkDigit(number, one[14]) },
        { name: "date of birth", valid: checkDigit(birth, two[6]) },
        { name: "expiry date", valid: checkDigit(expiry, two[14]) },
        { name: "composite", valid: checkDigit(composite, two[29]) },
      ],
    };
  }
  return null;
}

// ── Names, addresses, dates ─────────────────────────────────────────────────

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length > 0);
}

// Share (0–1) of the expected name's words found in the document's name, in
// any order, so "WANJIRU Jane" matches "Jane Wanjiru".
export function nameMatchScore(expected: string, actual: string): number {
  const want = tokens(expected);
  const have = new Set(tokens(actual));
  if (want.length === 0 || have.size === 0) return 0;
  // An initial matches a full name ("J" and "Jane").
  const isInitialOf = (initial: string, word: string) => initial.length === 1 && word.startsWith(initial);
  const found = want.filter((token) => have.has(token) || [...have].some((other) => isInitialOf(token, other) || isInitialOf(other, token)));
  return found.length / want.length;
}

const ADDRESS_STOPWORDS = new Set(["the", "of", "and", "p", "o", "box", "road", "rd", "street", "st", "avenue", "ave", "estate", "house", "apartment", "apt", "flat", "floor", "kenya"]);

// Share (0–1) of the expected address's significant words (numbers, street
// and place names) found in the document's address.
export function addressMatchScore(expected: string, actual: string): number {
  const want = tokens(expected).filter((token) => !ADDRESS_STOPWORDS.has(token));
  const have = new Set(tokens(actual));
  if (want.length === 0 || have.size === 0) return 0;
  return want.filter((token) => have.has(token)).length / want.length;
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function ageOn(birthDate: string, now: number): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const today = new Date(now);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function daysBetween(from: string, now: number) {
  return Math.floor((now - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
}

// ── Identity documents ──────────────────────────────────────────────────────

export type IdentityFields = {
  documentType: "passport" | "national_id" | "drivers_licence" | "residence_permit" | "other";
  issuingCountry: string | null;
  documentNumber: string | null;
  surname: string | null;
  givenNames: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  sex: "M" | "F" | "X" | null;
  nationality: string | null;
  placeOfBirth: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingAuthority: string | null;
  address: string | null;
  personalNumber: string | null;
  mrzLines: string[];
  hasFacePhoto: boolean;
  hasSignature: boolean;
};

export const MINIMUM_AGE = 18;

export function identityRuleChecks(
  fields: IdentityFields,
  now = Date.now(),
): { flags: FraudFlag[]; mrz: Mrz | null; age: number | null; isAdult: boolean | null; isExpired: boolean | null } {
  const flags: FraudFlag[] = [];
  const today = new Date(now).toISOString().slice(0, 10);

  for (const [field, label] of [
    ["documentNumber", "document number"],
    ["dateOfBirth", "date of birth"],
  ] as const) {
    if (!fields[field]) flags.push({ code: `missing_${field}`, severity: "medium", source: "rules", message: `The ${label} could not be read.` });
  }
  if (!fields.fullName && !fields.surname) {
    flags.push({ code: "missing_name", severity: "medium", source: "rules", message: "The holder's name could not be read." });
  }

  let age: number | null = null;
  if (fields.dateOfBirth) {
    if (!isIsoDate(fields.dateOfBirth)) {
      flags.push({ code: "invalid_birth_date", severity: "high", source: "rules", message: "The date of birth is not a valid date." });
    } else {
      age = ageOn(fields.dateOfBirth, now);
      if (fields.dateOfBirth > today) {
        flags.push({ code: "birth_date_in_future", severity: "critical", source: "rules", message: "The date of birth is in the future." });
      } else if (age > 120) {
        flags.push({ code: "implausible_age", severity: "high", source: "rules", message: `The date of birth gives an implausible age (${age}).` });
      }
    }
  }

  let isExpired: boolean | null = null;
  if (fields.expiryDate && isIsoDate(fields.expiryDate)) {
    isExpired = fields.expiryDate < today;
    if (isExpired) {
      flags.push({ code: "document_expired", severity: "critical", source: "rules", message: `The document expired on ${fields.expiryDate}.` });
    }
  } else if (fields.documentType !== "other") {
    flags.push({ code: "missing_expiry", severity: "medium", source: "rules", message: "The expiry date could not be read." });
  }
  if (fields.issueDate && isIsoDate(fields.issueDate)) {
    if (fields.issueDate > today) {
      flags.push({ code: "issue_date_in_future", severity: "critical", source: "rules", message: "The issue date is in the future." });
    }
    if (fields.expiryDate && isIsoDate(fields.expiryDate) && fields.issueDate >= fields.expiryDate) {
      flags.push({ code: "issue_after_expiry", severity: "critical", source: "rules", message: "The issue date is not before the expiry date." });
    }
    if (fields.dateOfBirth && isIsoDate(fields.dateOfBirth) && fields.issueDate < fields.dateOfBirth) {
      flags.push({ code: "issued_before_birth", severity: "critical", source: "rules", message: "The document was issued before the holder was born." });
    }
  }

  // MRZ: present on passports and most ID cards and residence permits.
  const mrz = fields.mrzLines.length ? parseMrz(fields.mrzLines, now) : null;
  if (fields.mrzLines.length && !mrz) {
    flags.push({ code: "mrz_unreadable", severity: "medium", source: "mrz", message: "The machine-readable zone could not be read in full." });
  }
  if (mrz) {
    const failed = mrz.checks.filter((check) => !check.valid).map((check) => check.name);
    if (failed.length) {
      flags.push({
        code: "mrz_check_digit_failed",
        severity: "critical",
        source: "mrz",
        message: `Machine-readable zone check digit${failed.length === 1 ? "" : "s"} failed: ${failed.join(", ")}.`,
      });
    }
    const mismatches: string[] = [];
    if (fields.documentNumber && normalizeText(fields.documentNumber).replace(/ /g, "") !== mrz.documentNumber.toLowerCase()) mismatches.push("document number");
    if (fields.dateOfBirth && mrz.birthDate && fields.dateOfBirth !== mrz.birthDate) mismatches.push("date of birth");
    if (fields.expiryDate && mrz.expiryDate && fields.expiryDate !== mrz.expiryDate) mismatches.push("expiry date");
    if (fields.sex && fields.sex !== "X" && mrz.sex !== "X" && fields.sex !== mrz.sex) mismatches.push("sex");
    const printedName = fields.fullName ?? [fields.givenNames, fields.surname].filter(Boolean).join(" ");
    if (printedName && mrz.surname && nameMatchScore(`${mrz.surname} ${mrz.givenNames}`, printedName) < 0.5) mismatches.push("name");
    if (mismatches.length) {
      flags.push({
        code: "mrz_mismatch",
        severity: "critical",
        source: "mrz",
        message: `The machine-readable zone doesn't match the printed ${mismatches.join(", ")}.`,
      });
    }
  } else if (fields.documentType === "passport") {
    flags.push({ code: "mrz_missing", severity: "high", source: "mrz", message: "No machine-readable zone was found on the passport." });
  }

  if ((fields.documentType === "passport" || fields.documentType === "national_id" || fields.documentType === "drivers_licence") && !fields.hasFacePhoto) {
    flags.push({ code: "face_photo_missing", severity: "high", source: "rules", message: "No holder photo was found on the document." });
  }

  return { flags, mrz, age, isAdult: age === null ? null : age >= MINIMUM_AGE, isExpired };
}

// ── Proof of address ────────────────────────────────────────────────────────

export const POA_DOCUMENT_TYPES = [
  "electricity_bill",
  "water_bill",
  "gas_bill",
  "internet_bill",
  "telephone_bill",
  "mobile_phone_bill",
  "tv_subscription_bill",
  "bank_statement",
  "credit_card_statement",
  "mortgage_statement",
  "loan_statement",
  "salary_slip",
  "employer_letter",
  "tax_document",
  "government_letter",
  "council_tax_bill",
  "rental_agreement",
  "property_rates_bill",
  "insurance_document",
  "pension_statement",
  "vehicle_registration",
  "school_letter",
  "medical_bill",
  "other",
] as const;
export type PoaDocumentType = (typeof POA_DOCUMENT_TYPES)[number];

export type PoaFields = {
  documentType: PoaDocumentType;
  issuerName: string | null;
  holderName: string | null;
  address: string | null;
  issueDate: string | null;
  accountReference: string | null;
};

export const DEFAULT_POA_MAX_AGE_DAYS = 90;
const NAME_MATCH_MIN = 0.67;
const ADDRESS_MATCH_MIN = 0.6;

export function proofOfAddressChecks(
  fields: PoaFields,
  expected: { name?: string; address?: string },
  options: { maxAgeDays?: number; now?: number } = {},
): {
  flags: FraudFlag[];
  nameMatch: number | null;
  addressMatch: number | null;
  documentAgeDays: number | null;
} {
  const now = options.now ?? Date.now();
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_POA_MAX_AGE_DAYS;
  const flags: FraudFlag[] = [];
  if (!fields.address) flags.push({ code: "missing_address", severity: "high", source: "rules", message: "No address could be read from the document." });
  if (!fields.holderName) flags.push({ code: "missing_name", severity: "high", source: "rules", message: "No account holder name could be read." });
  if (!fields.issuerName) flags.push({ code: "missing_issuer", severity: "medium", source: "rules", message: "The issuing organisation could not be identified." });
  if (fields.documentType === "other") {
    flags.push({ code: "unrecognised_document_type", severity: "medium", source: "rules", message: "The document is not a recognised proof-of-address type." });
  }

  let documentAgeDays: number | null = null;
  if (!fields.issueDate || !isIsoDate(fields.issueDate)) {
    flags.push({ code: "missing_issue_date", severity: "high", source: "rules", message: "The issue date could not be read." });
  } else {
    documentAgeDays = daysBetween(fields.issueDate, now);
    if (documentAgeDays < 0) {
      flags.push({ code: "issue_date_in_future", severity: "critical", source: "rules", message: "The issue date is in the future." });
    } else if (documentAgeDays > maxAgeDays) {
      flags.push({
        code: "document_too_old",
        severity: "high",
        source: "rules",
        message: `The document is ${documentAgeDays} days old; the limit is ${maxAgeDays} days.`,
      });
    }
  }

  const nameMatch = expected.name && fields.holderName ? nameMatchScore(expected.name, fields.holderName) : null;
  if (nameMatch !== null && nameMatch < NAME_MATCH_MIN) {
    flags.push({ code: "name_mismatch", severity: "high", source: "rules", message: `The name on the document ("${fields.holderName}") doesn't match "${expected.name}".` });
  }
  const addressMatch = expected.address && fields.address ? addressMatchScore(expected.address, fields.address) : null;
  if (addressMatch !== null && addressMatch < ADDRESS_MATCH_MIN) {
    flags.push({ code: "address_mismatch", severity: "high", source: "rules", message: "The address on the document doesn't match the declared address." });
  }
  return { flags, nameMatch, addressMatch, documentAgeDays };
}

// ── OCR cross-check ─────────────────────────────────────────────────────────

// Checks that values the AI read also appear in the independent OCR text.
// A value the AI "read" that the OCR can't find suggests a misread or a
// fabricated value.
export function ocrCrossCheck(ocrText: string, values: Record<string, string | null | undefined>): { checked: string[]; missing: string[] } {
  const haystack = normalizeText(ocrText).replace(/ /g, "");
  const checked: string[] = [];
  const missing: string[] = [];
  for (const [label, value] of Object.entries(values)) {
    if (!value) continue;
    const variants = label.toLowerCase().includes("date") ? dateVariants(value) : [normalizeText(value).replace(/ /g, "")];
    if (variants.every((variant) => variant.length < 3)) continue;
    checked.push(label);
    if (!variants.some((variant) => variant && haystack.includes(variant))) missing.push(label);
  }
  return { checked, missing };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dateVariants(iso: string): string[] {
  if (!isIsoDate(iso)) return [normalizeText(iso).replace(/ /g, "")];
  const [year, month, day] = iso.split("-");
  const shortYear = year.slice(2);
  const monthName = MONTHS[Number(month) - 1];
  return [
    `${day}${month}${year}`,
    `${month}${day}${year}`,
    `${year}${month}${day}`,
    `${day}${monthName}${year}`,
    `${Number(day)}${monthName}${year}`,
    `${day}${month}${shortYear}`,
    `${day}${monthName}${shortYear}`,
  ];
}

// ── Verdict ─────────────────────────────────────────────────────────────────

const SEVERITY_POINTS: Record<FlagSeverity, number> = { critical: 60, high: 30, medium: 12, low: 3 };

// Fraud risk 0–100 from the flags, and the verdict: any critical flag
// rejects, any high or medium flag needs review, otherwise pass.
export function documentVerdict(flags: FraudFlag[]): { verdict: "pass" | "review" | "reject"; riskScore: number } {
  const riskScore = Math.min(100, flags.reduce((sum, flag) => sum + SEVERITY_POINTS[flag.severity], 0));
  if (flags.some((flag) => flag.severity === "critical")) return { verdict: "reject", riskScore };
  if (flags.some((flag) => flag.severity === "high" || flag.severity === "medium")) return { verdict: "review", riskScore };
  return { verdict: "pass", riskScore };
}

export function dedupeFlags(flags: FraudFlag[]): FraudFlag[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    if (seen.has(flag.code)) return false;
    seen.add(flag.code);
    return true;
  });
}
