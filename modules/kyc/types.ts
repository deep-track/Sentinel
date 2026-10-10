import { z } from "zod";

// Frontend-only shapes for the dashboard KYC wizard. These intentionally do
// not include liveness fields: the dashboard flow collects a still selfie,
// which is NOT liveness evidence, so nothing is sent as livenessFramesBase64.

export type KYCDocumentType = "passport" | "id_card" | "driving_license";

export type KYCDocumentData = {
  documentType: KYCDocumentType;
  documentFrontUrl: string;
  /** Raw base64 (no data: prefix) of the compressed front image. */
  documentFrontBase64: string;
  documentBackUrl?: string;
  /** Raw base64 (no data: prefix) of the compressed back image. */
  documentBackBase64?: string;
};

export type KYCSelfieData = {
  selfieUrl: string;
  /** Raw base64 (no data: prefix) of the compressed selfie. */
  selfieBase64: string;
};

const ID_NUMBER_PATTERN = /^[A-Za-z0-9]{5,20}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MINIMUM_AGE = 18;

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Whole years between `dob` and `today` (both calendar dates). */
export function ageOn(dob: { year: number; month: number; day: number }, today: Date): number {
  let age = today.getFullYear() - dob.year;
  const beforeBirthday =
    today.getMonth() + 1 < dob.month || (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Today's date as YYYY-MM-DD in the viewer's timezone (for `max` on date inputs). */
export function todayIsoDate(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export const kycIdentitySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(100, "Last name is too long"),
  idNumber: z
    .string()
    .trim()
    .regex(ID_NUMBER_PATTERN, "ID number must be 5–20 letters or digits (no spaces or symbols)"),
  dateOfBirth: z.string().superRefine((value, ctx) => {
    const dob = parseIsoDate(value);
    if (!dob) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date of birth" });
      return;
    }
    const today = new Date();
    const dobDate = new Date(dob.year, dob.month - 1, dob.day);
    if (dobDate.getTime() >= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date of birth must be in the past" });
      return;
    }
    if (dob.year < 1900) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date of birth" });
      return;
    }
    if (ageOn(dob, today) < MINIMUM_AGE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The person must be at least ${MINIMUM_AGE} years old` });
    }
  }),
  gender: z.enum(["male", "female", "other"], {
    errorMap: () => ({ message: "Select a gender" }),
  }),
});

export type KYCIdentityData = z.infer<typeof kycIdentitySchema>;

export type KYCWizardData = Partial<KYCDocumentData & KYCSelfieData> & Partial<Record<keyof KYCIdentityData, string>>;
