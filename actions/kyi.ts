"use server";

import { randomUUID } from "crypto";
import { buildShuftiRequest, createShuftiVerification } from "@/lib/shufti";
import type { KYIActionResult, KYIRecord, KYISubmissionData, KYIStatus } from "@/lib/kyi-types";
import { getAuth, getCurrentUser } from "@/lib/auth";

const BACKEND = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function requireBackend() {
  if (!BACKEND) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }
}

/**
 * PART 5: Submit KYI data with Shufti integration
 * Sends all 3 steps (profile, identity, financial docs) to backend
 */
export async function submitKYI(
  payload: KYISubmissionData,
): Promise<KYIActionResult<{ kyiId: string; reference: string }>> {
  try {
    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const currentUser = await getCurrentUser();
    if (!currentUser) return { success: false, error: "User not found" };

    const reference = `KYI-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

    // Build Shufti request from identity step data
    const shuftiRequest = buildShuftiRequest({
      reference,
      email: payload.email,
      country: payload.countryOfResidence,
      documentType:
        payload.governmentIdType === "national_id"
          ? "id_card"
          : payload.governmentIdType === "driving_license"
          ? "driving_license"
          : "passport",
      documentFrontBase64: payload.governmentIdBase64,
      documentBackBase64: payload.governmentIdBackBase64,
      selfieBase64: payload.selfieBase64,
    });

    // Call Shufti Pro API
    const shuftiResponse = await createShuftiVerification(shuftiRequest);

    const initialStatus =
      shuftiResponse.event === "verification.accepted"
        ? "approved"
        : shuftiResponse.event === "verification.declined"
        ? "declined"
        : "processing";

    // POST to backend API
    const res = await fetch(`${BACKEND}/api/kyi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Metadata
        reference,
        userId: auth.userId,
        userEmail: currentUser.email,
        userName: currentUser.fullName,

        // Step 1: Investor Profile
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        nationality: payload.nationality,
        countryOfResidence: payload.countryOfResidence,
        dateOfBirth: payload.dateOfBirth,
        investorType: payload.investorType,
        accreditationStatus: payload.accreditationStatus,
        sourceOfFunds: payload.sourceOfFunds,
        netWorthRange: payload.netWorthRange,
        investmentAmount: payload.investmentAmount,
        investmentCurrency: payload.investmentCurrency,
        isPEP: payload.isPEP,
        pepDetails: payload.pepDetails,

        // Step 2: Identity Verification
        governmentIdType: payload.governmentIdType,
        governmentIdUrl: payload.governmentIdUrl,
        governmentIdBackUrl: payload.governmentIdBackUrl,
        selfieUrl: payload.selfieUrl,

        // Step 3: Financial Documents
        bankStatementUrl: payload.bankStatementUrl,
        proofOfAddressUrl: payload.proofOfAddressUrl,
        proofOfNetWorthUrl: payload.proofOfNetWorthUrl,
        accreditationLetterUrl: payload.accreditationLetterUrl,
        sourceOfFundsDocUrl: payload.sourceOfFundsDocUrl,
        corporateDocUrl: payload.corporateDocUrl,

        // Shufti integration
        status: initialStatus,
        shuftiEventType: shuftiResponse.event,

        // Timestamp
        submittedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Backend error: ${text}`);
    }

    const responseBody = await res.json();
    const data = responseBody?.data;

    return {
      success: true,
      data: {
        kyiId: data.id,
        reference,
      },
    };
  } catch (err) {
    console.error("[submitKYI]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Submission failed",
    };
  }
}

/**
 * Fetch KYI record by ID with polling for status updates
 */
export async function getKYIRecord(id: string): Promise<KYIActionResult<KYIRecord>> {
  try {
    requireBackend();
    const res = await fetch(`${BACKEND}/api/kyi/${id}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);

    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[getKYIRecord]", err);
    return { success: false, error: "Failed to fetch KYI record" };
  }
}

/**
 * Fetch KYI records with optional filtering
 */
export async function getKYIList(params?: {
  status?: KYIStatus;
  investorType?: string;
  page?: number;
  limit?: number;
}): Promise<KYIActionResult<{ records: KYIRecord[]; total: number }>> {
  try {
    if (!BACKEND) {
      return { success: true, data: { records: [], total: 0 } };
    }

    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.investorType) qs.set("investorType", params.investorType);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit ?? 20));
    qs.set("userId", auth.userId);

    const res = await fetch(`${BACKEND}/api/kyi?${qs.toString()}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status >= 500) {
        console.info(`[getKYIList] upstream unavailable (${res.status})`);
        return { success: true, data: { records: [], total: 0 } };
      }
      throw new Error(`Backend ${res.status}`);
    }

    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[getKYIList]", err);
    return { success: false, error: "Failed to fetch KYI records" };
  }
}

/**
 * Fetch KYI stats for dashboard
 */
export async function getKYIStats(): Promise<
  KYIActionResult<{
    total: number;
    approved: number;
    declined: number;
    pending: number;
    processing: number;
    requires_review: number;
    pepCount: number;
  }>
> {
  try {
    requireBackend();

    const res = await fetch(`${BACKEND}/api/kyi/stats`, {
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Stats failed: ${res.status}`);
    const data = await res.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error("[getKYIStats]", err);
    return { success: false, error: "Failed to fetch KYI stats" };
  }
}

/**
 * Refresh KYI status from Shufti Pro
 */
export async function refreshKYIFromShufti(
  id: string,
  reference: string,
): Promise<KYIActionResult<KYIRecord>> {
  try {
    requireBackend();

    const res = await fetch(`${BACKEND}/api/kyi/${id}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);

    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[refreshKYIFromShufti]", err);
    return { success: false, error: "Failed to refresh verification status" };
  }
}

/**
 * Review KYI submission (approve/decline)
 */
export async function reviewKYI(params: {
  id: string;
  decision: "approved" | "declined";
  notes?: string;
  declineReason?: string;
}): Promise<KYIActionResult<KYIRecord>> {
  try {
    requireBackend();
    const res = await fetch(`${BACKEND}/api/kyi/${params.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: params.decision,
        reviewNotes: params.notes,
        declineReason: params.declineReason,
        reviewedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);

    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[reviewKYI]", err);
    return { success: false, error: "Failed to submit review decision" };
  }
}
