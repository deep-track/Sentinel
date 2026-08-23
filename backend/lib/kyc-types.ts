import { z } from "zod";

export const kycSubmissionSchema = z.object({
  documentType: z.enum(["passport", "id_card", "driving_license"], {
    required_error: "Document type is required",
  }),
  documentFrontUrl: z.string().min(1, "Front of document is required"),
  documentBackUrl: z.string().optional(),
  documentFrontBase64: z.string().min(1, "Front image data required"),
  documentBackBase64: z.string().optional(),
  selfieUrl: z.string().min(1, "Selfie is required"),
  selfieBase64: z.string().min(1, "Selfie image data required"),
});

export type KYCSubmissionData = z.infer<typeof kycSubmissionSchema>;

export type KYCExtractedData = {
  name?: { first_name?: string; last_name?: string; middle_name?: string };
  dob?: string;
  document_number?: string;
  expiry_date?: string;
  issue_date?: string;
  country?: string;
  gender?: string;
  nationality?: string;
  address?: {
    full_address?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  [key: string]: unknown;
};

export type KYCStatus =
  | "draft"
  | "pending"
  | "processing"
  | "approved"
  | "declined"
  | "requires_review"
  | "expired";

export type KYCRecord = {
  id: string;
  reference: string;
  userId: string;
  userEmail: string;
  userName: string;
  companyId: string;
  status: KYCStatus;
  submittedAt?: string;
  reviewedAt?: string;
  expiresAt?: string;
  shuftiEventType?: string;
  shuftiVerificationUrl?: string;
  documentType: string;
  documentFrontUrl?: string;
  documentBackUrl?: string;
  selfieUrl?: string;
  extractedData?: KYCExtractedData;
  verificationResult?: Record<string, 0 | 1>;
  declinedCodes?: string[];
  servicesDeclinedCodes?: Record<string, string[]> | null;
  additionalData?: Record<string, unknown> | null;
  declineReason?: string;
  reviewNotes?: string;
  riskScore?: number;
  createdAt: string;
  updatedAt: string;
};

export type KYCInvitation = {
  id: string;
  email: string;
  name?: string;
  companyId: string;
  invitedBy: string;
  token: string;
  status: "pending" | "in_progress" | "completed" | "expired";
  expiresAt: string;
  createdAt: string;
};

export type KYCSubmitPayload = KYCSubmissionData;

export type ShuftiWebhookPayload = {
  reference: string;
  event:
    | "request.received"
    | "request.pending"
    | "request.timeout"
    | "request.deleted"
    | "request.unauthorized"
    | "verification.accepted"
    | "verification.declined"
    | "verification.cancelled"
    | "review.pending"
    | "review.accepted"
    | "review.declined";
  verification_data?: Record<string, unknown>;
  verification_result?: Record<string, 0 | 1>;
  declined_reason?: string;
  declined_codes?: string | string[];
  services_declined_codes?: {
    document?: string[];
    face?: string[];
    address?: string[];
  };
  additional_data?: Record<string, unknown>;
  info?: { agent?: Record<string, unknown>; geolocation?: Record<string, unknown> };
};

export type KYCActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
