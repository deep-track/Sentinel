export type KYCDocumentType = "passport" | "id_card" | "driving_license";
export type KYCGender = "male" | "female" | "other";

export type KYCSubmissionData = {
  firstName: string;
  lastName: string;
  idNumber: string;
  dateOfBirth: string;
  gender: KYCGender;
  documentType: KYCDocumentType;
  documentFrontUrl: string;
  documentBackUrl?: string;
  documentFrontBase64: string;
  documentBackBase64?: string;
  selfieUrl: string;
  selfieBase64: string;
};

export type KYCStatus = "pending" | "processing" | "approved" | "declined" | "requires_review";