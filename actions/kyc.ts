"use server";

import { randomUUID } from "crypto";
import {
  buildShuftiRequest,
  createShuftiVerification,
  getShuftiVerificationStatus,
  mapShuftiEventToStatus,
} from "@/lib/shufti";
import type {
  KYCActionResult,
  KYCRecord,
  KYCSubmitPayload,
  KYCStatus,
} from "@/lib/kyc-types";
import { getAuth, getCurrentUser } from "@/lib/auth";

const BACKEND = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function requireBackend() {
  if (!BACKEND) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }
}

export async function submitKYC(
  payload: KYCSubmitPayload,
): Promise<KYCActionResult<{ kycId: string; reference: string }>> {
  try {
    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const currentUser = await getCurrentUser();
    if (!currentUser) return { success: false, error: "User not found" };

    const reference = `KYC-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

    const shuftiRequest = buildShuftiRequest({
      reference,
      email: currentUser.email,
      country: "US",
      documentType: payload.documentType,
      documentFrontBase64: payload.documentFrontBase64,
      documentBackBase64: payload.documentBackBase64,
      selfieBase64: payload.selfieBase64,
    });

    const shuftiResponse = await createShuftiVerification(shuftiRequest);

    console.log("[submitKYC] Shufti response:", {
      event: shuftiResponse.event,
      reference: shuftiResponse.reference,
    });

    const initialStatus =
      shuftiResponse.event === "verification.accepted"
        ? "approved"
        : shuftiResponse.event === "verification.declined"
          ? "declined"
          : "processing";

    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://deeptrack-platform.onrender.com";

    const res = await fetch(`${appUrl}/api/kyc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference,
        userId: auth.userId,
        userEmail: currentUser.email,
        userName: currentUser.fullName,
        documentType: payload.documentType,
        documentFrontUrl: payload.documentFrontUrl,
        documentBackUrl: payload.documentBackUrl,
        selfieUrl: payload.selfieUrl,
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
        kycId: data.id,
        reference,
      },
    };
  } catch (err) {
    console.error("[submitKYC]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Submission failed",
    };
  }
}

export async function getKYCList(params?: {
  status?: KYCStatus;
  page?: number;
  limit?: number;
}): Promise<KYCActionResult<{ records: KYCRecord[]; total: number }>> {
  try {
    if (!BACKEND) {
      return { success: true, data: { records: [], total: 0 } };
    }
    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit ?? 20));
    qs.set("userId", auth.userId);

    const res = await fetch(`${BACKEND}/api/kyc?${qs.toString()}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status >= 500) {
        console.info(`[getKYCList] upstream unavailable (${res.status})`);
        return { success: true, data: { records: [], total: 0 } };
      }
      throw new Error(`Backend ${res.status}`);
    }
    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[getKYCList]", err);
    return { success: false, error: "Failed to fetch KYC records" };
  }
}

export async function getKYCRecord(id: string): Promise<KYCActionResult<KYCRecord>> {
  try {
    console.log("[getKYCRecord] Fetching:", id);
    
    requireBackend();
    const res = await fetch(`${BACKEND}/api/kyc/${id}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const responseBody = await res.json();
    const record = responseBody?.data;
    
    console.log("[getKYCRecord] status:", record?.status);
    console.log("[getKYCRecord] declinedCodes:", record?.declinedCodes);
    console.log("[getKYCRecord] has servicesDeclinedCodes:", !!record?.servicesDeclinedCodes);
    
    return { success: true, data: record };
  } catch (err) {
    console.error("[getKYCRecord]", err);
    return { success: false, error: "Failed to fetch KYC record" };
  }
}

export async function getMyKYCStatus(): Promise<KYCActionResult<KYCRecord | null>> {
  try {
    requireBackend();
    const auth = await getAuth();
    if (!auth?.userId) return { success: false, error: "Not authenticated" };

    const res = await fetch(`${BACKEND}/api/kyc/me?userId=${encodeURIComponent(auth.userId)}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (res.status === 404) return { success: true, data: null };
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const responseBody = await res.json();
    return { success: true, data: responseBody?.data };
  } catch (err) {
    console.error("[getMyKYCStatus]", err);
    return { success: false, error: "Failed to fetch your KYC status" };
  }
}

export async function refreshKYCFromShufti(
  id: string,
  reference: string,
): Promise<KYCActionResult<KYCRecord>> {
  try {
    requireBackend();
    const shuftiStatus = await getShuftiVerificationStatus(reference);
    const newStatus = mapShuftiEventToStatus(shuftiStatus.event);

    const res = await fetch(`${BACKEND}/api/kyc/${id}`, {
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
    console.error("[refreshKYCFromShufti]", err);
    return { success: false, error: "Failed to refresh verification status" };
  }
}

export async function pollShuftiStatus(
  kycId: string,
  reference: string,
): Promise<KYCActionResult<KYCRecord>> {
  try {
    const shuftiStatus = await getShuftiVerificationStatus(reference);
    const newStatus = mapShuftiEventToStatus(shuftiStatus.event);

    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://deeptrack-platform.onrender.com";

    const res = await fetch(`${appUrl}/api/kyc/${kycId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        shuftiEventType: shuftiStatus.event,
      }),
    });

    if (!res.ok) throw new Error(`Update failed: ${res.status}`);
    const data = await res.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error("[pollShuftiStatus]", err);
    return { success: false, error: "Failed to poll Shufti status" };
  }
}

export async function reviewKYC(params: {
  id: string;
  decision: "approved" | "declined";
  notes?: string;
  declineReason?: string;
}): Promise<KYCActionResult<KYCRecord>> {
  try {
    requireBackend();
    const res = await fetch(`${BACKEND}/api/kyc/${params.id}/review`, {
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
    console.error("[reviewKYC]", err);
    return { success: false, error: "Failed to submit review decision" };
  }
}

export async function getKYCStats(): Promise<
  KYCActionResult<{
    total: number;
    approved: number;
    declined: number;
    pending: number;
    processing: number;
    requires_review: number;
  }>
> {
  try {
    const appUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://deeptrack-platform.onrender.com";

    const res = await fetch(`${appUrl}/api/kyc/stats`, {
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Stats failed: ${res.status}`);
    const data = await res.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error("[getKYCStats]", err);
    return { success: false, error: "Failed to fetch KYC stats" };
  }
}
