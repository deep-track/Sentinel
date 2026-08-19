export type APIKey = {
  id: string;
  name: string;
  apiKey: string;
  status: "Active" | "Suspended";
  createdAt: string | Date | null;
};