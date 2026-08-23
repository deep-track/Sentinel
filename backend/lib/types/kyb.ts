export type KYBRecord = {
  id: string;
  businessName: string;
  reference: string;
  country: string;
  status: "pending" | "processing" | "approved" | "declined" | "requires_review" | "expired";
  createdAt: string | Date | null;
};