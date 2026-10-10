import type { DocumentType, KYBStepData, Position } from "@/backend/lib/kyb-types";

// Wizard-local shapes. They extend the shared KYB types in
// backend/lib/kyb-types.ts with what kyb.createKyb actually needs: an
// uploaded URL per document (not base64) and an ID number per director.

export type KYBUploadedDocument = {
  type: DocumentType;
  fileName: string;
  mimeType: string;
  /** Permanent UploadThing URL. */
  url: string;
};

export type KYBPerson = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  idNumber: string;
  position: Position;
  shareholding: string;
};

export type KYBWizardData = {
  businessInfo: KYBStepData["businessInfo"];
  documents: KYBUploadedDocument[];
  ubos: KYBPerson[];
};

/** Documents kyb.createKyb stores, and the argument each one maps to. */
export const KYB_DOCUMENT_FIELDS = {
  incorporation_certificate: "registrationDocUrl",
  utility_bill: "proofOfAddressUrl",
} as const satisfies Partial<Record<DocumentType, string>>;

export type KYBSubmittedDocumentType = keyof typeof KYB_DOCUMENT_FIELDS;

export function createEmptyPerson(): KYBPerson {
  return {
    id: crypto.randomUUID(),
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    email: "",
    idNumber: "",
    position: "director",
    shareholding: "",
  };
}

export function createInitialWizardData(): KYBWizardData {
  return {
    businessInfo: { businessName: "", registrationNumber: "", country: "" },
    documents: [],
    ubos: [createEmptyPerson()],
  };
}
