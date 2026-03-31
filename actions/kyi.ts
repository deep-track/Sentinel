"use server";

import { randomUUID } from "crypto";
import {
  buildShuftiRequest,
  createShuftiVerification,
  getShuftiVerificationStatus,
  mapShuftiEventToStatus,
} from "@/lib/shufti";
import type {
  KYIActionResult,
  KYIRecord,
  KYISubmitPayload,
  KYIStatus,
} from "@/lib/kyi-types";
import { getAuth, getCurrentUser } from "@/lib/auth";

const BACKEND = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function requireBackend() {
  if (!BACKEND) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }
}

export async function submitKYI(
  payload: KYISubmitPayload,
): Promise<KYIActionResult<{ kyiId: string; reference: string }>> {
  try {
    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const currentUser = await getCurrentUser();
    if (!currentUser) return { success: false, error: "User not found" };

    const reference = `KYI-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

    const shuftiRequest = buildShuftiRequest({
      reference,
      email: currentUser.email,
      country: "US",
      documentType:
        payload.governmentIdType === "national_id"
          ? "id_card"
          : payload.governmentIdType === "driving_license"
            ? "driving_license"
            : "passport",
      documentFrontBase64: payload.governmentIdBase64,
      selfieBase64: payload.selfieBase64,
    });

    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://deeptrack-platform.onrender.com";

    const shuftiResponse = await createShuftiVerification(shuftiRequest);

    const initialStatus =
      shuftiResponse.event === "verification.accepted"
        ? "approved"
        : shuftiResponse.event === "verification.declined"
          ? "declined"
          : "processing";

    const res = await fetch(`${appUrl}/api/kyi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference,
        userId: auth.userId,
        userEmail: currentUser.email,
        userName: currentUser.fullName,
        investorType: payload.investorType,
        accreditationStatus: payload.accreditationStatus,
        investmentAmount: payload.investmentAmount,
        investmentCurrency: payload.investmentCurrency,
        sourceOfFunds: payload.sourceOfFunds,
        isPEP: payload.isPEP,
        governmentIdType: payload.governmentIdType,
        governmentIdUrl: payload.governmentIdUrl,
        selfieUrl: payload.selfieUrl,
        bankStatementUrl: payload.bankStatementUrl,
        proofOfAddressUrl: payload.proofOfAddressUrl,
        proofOfNetWorthUrl: payload.proofOfNetWorthUrl,
        accreditationLetterUrl: payload.accreditationLetterUrl,
        sourceOfFundsDocUrl: payload.sourceOfFundsDocUrl,
        corporateDocUrl: payload.corporateDocUrl,
        status: initialStatus,
        shuftiEventType: shuftiResponse.event,
        shuftiVerificationUrl: null,
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

export async function refreshKYIFromShufti(
  id: string,
  reference: string,
): Promise<KYIActionResult<KYIRecord>> {
  try {
    requireBackend();
    const shuftiStatus = await getShuftiVerificationStatus(reference);
    const newStatus = mapShuftiEventToStatus(shuftiStatus.event);

    const res = await fetch(`${BACKEND}/api/kyi/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        shuftiEventType: shuftiStatus.event,
      }),
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);

    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[refreshKYIFromShufti]", err);
    return { success: false, error: "Failed to refresh verification status" };
  }
}

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
    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://deeptrack-platform.onrender.com";

    const res = await fetch(`${appUrl}/api/kyi/stats`, {
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
