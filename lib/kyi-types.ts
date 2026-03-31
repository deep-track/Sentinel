import { z } from "zod";

export const kyiSubmissionSchema = z.object({
  investorType: z.enum(
    [
      "individual",
      "joint",
      "corporate",
      "fund",
      "trust",
      "pension_fund",
      "family_office",
    ],
    { required_error: "Investor type is required" },
  ),
  accreditationStatus: z.enum(
    ["accredited", "qualified", "institutional", "retail"],
    { required_error: "Accreditation status is required" },
  ),
  investmentAmount: z.string().min(1, "Investment amount is required"),
  investmentCurrency: z.string().default("USD"),
  sourceOfFunds: z.enum(
    [
      "employment_income",
      "business_income",
      "investment_returns",
      "inheritance",
      "property_sale",
      "savings",
      "other",
    ],
    { required_error: "Source of funds is required" },
  ),
  isPEP: z.boolean().default(false),
  governmentIdType: z.enum(["passport", "national_id", "driving_license"]),
  governmentIdUrl: z.string().min(1, "Government ID is required"),
  governmentIdBase64: z.string().min(1, "Government ID image data required"),
  selfieUrl: z.string().min(1, "Selfie is required"),
  selfieBase64: z.string().min(1, "Selfie image data required"),
  bankStatementUrl: z.string().min(1, "Bank statement is required"),
  proofOfAddressUrl: z.string().min(1, "Proof of address is required"),
  proofOfNetWorthUrl: z.string().optional(),
  accreditationLetterUrl: z.string().optional(),
  sourceOfFundsDocUrl: z.string().optional(),
  corporateDocUrl: z.string().optional(),
});

export type KYISubmissionData = z.infer<typeof kyiSubmissionSchema>;

export type KYIExtractedData = {
  name?: { first_name?: string; last_name?: string; middle_name?: string };
  dob?: string;
  document_number?: string;
  expiry_date?: string;
  issue_date?: string;
  country?: string;
  nationality?: string;
  gender?: string;
  [key: string]: unknown;
};

export type KYIStatus =
  | "draft"
  | "pending"
  | "processing"
  | "approved"
  | "declined"
  | "requires_review"
  | "expired";

export type KYIRecord = {
  id: string;
  reference: string;
  userId: string;
  userEmail: string;
  userName: string;
  status: KYIStatus;
  isPEP: boolean;
  accreditationStatus?: string;
  investorType?: string;
  investmentAmount?: string;
  investmentCurrency?: string;
  sourceOfFunds?: string;
  governmentIdType?: string;
  governmentIdUrl?: string;
  selfieUrl?: string;
  bankStatementUrl?: string;
  proofOfAddressUrl?: string;
  proofOfNetWorthUrl?: string;
  accreditationLetterUrl?: string;
  sourceOfFundsDocUrl?: string;
  corporateDocUrl?: string;
  extractedData?: KYIExtractedData;
  verificationResult?: Record<string, 0 | 1>;
  riskScore?: number;
  declineReason?: string;
  reviewNotes?: string;
  shuftiEventType?: string;
  shuftiVerificationUrl?: string;
  submittedAt?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type KYIInvitation = {
  id: string;
  email: string;
  investorName?: string;
  invitedBy: string;
  token: string;
  status: "pending" | "in_progress" | "completed" | "expired";
  expiresAt: string;
  createdAt: string;
};

export type KYISubmitPayload = KYISubmissionData;

export type KYIActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
