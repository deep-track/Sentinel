import { z } from "zod";

// Display labels for enum values
export const INVESTOR_TYPE_LABELS: Record<string, string> = {
  individual: "Individual Investor",
  joint: "Joint Account",
  corporate: "Corporate Entity",
  fund: "Investment Fund",
  trust: "Trust",
  institutional: "Institutional Investor",
};

export const ACCREDITATION_LABELS: Record<string, string> = {
  accredited: "Accredited Investor",
  qualified: "Qualified Investor",
  institutional: "Institutional",
  retail: "Retail Investor",
};

export const SOURCE_OF_FUNDS_LABELS: Record<string, string> = {
  employment: "Employment Income",
  business: "Business Income",
  investments: "Investment Returns",
  inheritance: "Inheritance",
  property: "Property Sale",
  savings: "Savings",
  other: "Other Source",
};

export const NET_WORTH_LABELS: Record<string, string> = {
  under_100k: "Under $100K",
  "100k_500k": "$100K - $500K",
  "500k_1m": "$500K - $1M",
  "1m_5m": "$1M - $5M",
  above_5m: "$5M+",
};

// PART 1: Investor Profile Schema
export const investorProfileSchema = z.object({
  // Personal Information
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone is required"),
  nationality: z.string().min(1, "Nationality is required"),
  countryOfResidence: z.string().min(1, "Country of residence is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),

  // Investor Classification
  investorType: z.enum(["individual", "joint", "corporate", "fund", "trust", "institutional"], {
    required_error: "Investor type is required",
  }),
  accreditationStatus: z.enum(["accredited", "qualified", "institutional", "retail"], {
    required_error: "Accreditation status is required",
  }),
  sourceOfFunds: z.enum(["employment", "business", "investments", "inheritance", "property", "savings", "other"], {
    required_error: "Source of funds is required",
  }),
  netWorthRange: z.enum(["under_100k", "100k_500k", "500k_1m", "1m_5m", "above_5m"], {
    required_error: "Net worth range is required",
  }),
  investmentAmount: z.string().min(1, "Investment amount is required"),
  investmentCurrency: z.string().default("USD"),

  // PEP Declaration
  isPEP: z.boolean().default(false),
  pepDetails: z.string().optional(), // description of PEP role if isPEP is true
});

export type InvestorProfileData = z.infer<typeof investorProfileSchema>;

// PART 2: KYI Identity Schema (document verification via Shufti)
export const kyiIdentitySchema = z.object({
  governmentIdType: z.enum(["passport", "national_id", "driving_license"], {
    required_error: "Government ID type is required",
  }),
  // Front side (always required)
  governmentIdBase64: z.string().min(1, "Government ID front image is required"),
  governmentIdUrl: z.string().min(1, "Government ID front URL is required"),
  // Back side (required for driving license and national ID)
  governmentIdBackBase64: z.string().optional(),
  governmentIdBackUrl: z.string().optional(),
  // Selfie (always required)
  selfieBase64: z.string().min(1, "Selfie image is required"),
  selfieUrl: z.string().min(1, "Selfie URL is required"),
});

export type KYIIdentityData = z.infer<typeof kyiIdentitySchema>;

// PART 3: Financial Documents Schema (file uploads via UploadThing)
export const financialDocsSchema = z.object({
  // Required documents
  bankStatementUrl: z.string().min(1, "Bank statement is required"),
  proofOfAddressUrl: z.string().min(1, "Proof of address is required"),

  // Optional documents
  proofOfNetWorthUrl: z.string().optional(),
  accreditationLetterUrl: z.string().optional(),
  sourceOfFundsDocUrl: z.string().optional(),
  corporateDocUrl: z.string().optional(), // for corporate investors
});

export type FinancialDocsData = z.infer<typeof financialDocsSchema>;

// Complete submission payload combining all steps
export const kyiSubmissionSchema = investorProfileSchema
  .merge(kyiIdentitySchema)
  .merge(financialDocsSchema);

export type KYISubmissionData = z.infer<typeof kyiSubmissionSchema>;

// Extracted data from Shufti verification
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

// KYI status
export type KYIStatus =
  | "draft"
  | "pending"
  | "processing"
  | "approved"
  | "declined"
  | "requires_review"
  | "expired";

// Database record type
export type KYIRecord = {
  id: string;
  reference: string;
  userId: string;
  organizationId?: string;
  userName?: string;
  userEmail?: string;
  status: KYIStatus;

  // Profile Step
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  nationality?: string;
  countryOfResidence?: string;
  dateOfBirth?: string;
  investorType?: string;
  accreditationStatus?: string;
  sourceOfFunds?: string;
  netWorthRange?: string;
  investmentAmount?: string;
  investmentCurrency?: string;
  isPEP: boolean;
  pepDetails?: string;

  // Identity Step
  governmentIdType?: string;
  governmentIdUrl?: string;
  governmentIdBackUrl?: string;
  selfieUrl?: string;

  // Financial Docs Step
  bankStatementUrl?: string;
  proofOfAddressUrl?: string;
  proofOfNetWorthUrl?: string;
  accreditationLetterUrl?: string;
  sourceOfFundsDocUrl?: string;
  corporateDocUrl?: string;

  // Verification data
  extractedData?: KYIExtractedData;
  additionalData?: Record<string, unknown>;
  verificationResult?: Record<string, 0 | 1>;
  shuftiEventType?: string;
  declineReason?: string;
  declinedCodes?: string[];
  servicesDeclinedCodes?: Record<string, unknown>;
  reviewNotes?: string;
  reviewedBy?: string;
  invitationToken?: string;

  submittedAt?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// KYI Invitation
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

// Action result wrapper
export type KYIActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
