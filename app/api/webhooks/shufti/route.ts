import type { ShuftiWebhookPayload } from "@/lib/kyc-types";
import { mapShuftiEventToStatus } from "@/lib/shufti";
import { mapShuftiEventToKYBStatus } from "@/lib/shufti-kyb";
import { type NextRequest, NextResponse } from "next/server";

const APP_URL =
	process.env.NEXT_PUBLIC_APP_URL ?? "https://deeptrack-platform.onrender.com";

export async function POST(req: NextRequest): Promise<NextResponse> {
	try {
		const rawBody = await req.text();

		console.log("=== SHUFTI WEBHOOK RECEIVED ===");
		console.log("Raw body length:", rawBody.length);

		let payload: ShuftiWebhookPayload;
		try {
			payload = JSON.parse(rawBody);
		} catch (e) {
			console.error("[Shufti Webhook] Failed to parse webhook body:", e);
			return NextResponse.json(
				{ error: "Invalid JSON" },
				{ status: 400 }
			);
		}

		console.log("[Webhook] Event:", payload.event);
		console.log("[Webhook] Reference:", payload.reference);
		console.log("[Webhook] declined_reason:", payload.declined_reason);
		console.log("[Webhook] declined_codes:", JSON.stringify(payload.declined_codes));
		console.log("[Webhook] services_declined_codes:", JSON.stringify(payload.services_declined_codes));
		console.log("[Webhook] has verification_data:", !!payload.verification_data);
		console.log("[Webhook] has additional_data:", !!payload.additional_data);

		if (!payload.reference || !payload.event) {
			console.error("[Shufti Webhook] Missing reference or event");
			return NextResponse.json(
				{ error: "Invalid payload" },
				{ status: 400 }
			);
		}

		const appUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || APP_URL;
		const isKYI = payload.reference.startsWith("KYI-");
		const isKYC = payload.reference.startsWith("KYC-");
		const isKYB = payload.reference.startsWith("KYB-");

		const endpoint = isKYI
			? `${appUrl}/api/kyi/by-reference/${payload.reference}`
			: isKYC
				? `${appUrl}/api/kyc/by-reference/${payload.reference}`
				: isKYB
					? `${appUrl}/api/kyb/by-reference/${payload.reference}`
					: `${appUrl}/api/kyc/by-reference/${payload.reference}`;

		const newStatus = isKYB
			? mapShuftiEventToKYBStatus(payload.event)
			: mapShuftiEventToStatus(payload.event);

	// Extract declined codes from payload if verification was declined
	const declinedCodes = Array.isArray(payload.declined_codes)
		? payload.declined_codes
		: payload.declined_codes
			? [payload.declined_codes]
			: [];

	console.log("[Webhook] Calling:", endpoint);

	const updateBody = {
		status: newStatus,
		shuftiEventType: payload.event,
		declineReason: payload.declined_reason ?? null,
		// Top-level decline codes
		declinedCodes: declinedCodes,
		// Per-service decline codes (document, face, address)
		servicesDeclinedCodes: payload.services_declined_codes ?? null,
		// Standard OCR data in verification_data.document
		extractedData: payload.verification_data ?? null,
		// Enhanced data in additional_data.document.proof
		additionalData: payload.additional_data ?? null,
		verificationResult: payload.verification_result ?? null,
	};

	console.log("[Webhook] Update body declinedCodes:", updateBody.declinedCodes);
	console.log("[Webhook] Has servicesDeclinedCodes:", !!updateBody.servicesDeclinedCodes);		const response = await fetch(endpoint, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(updateBody),
		});

		const responseText = await response.text();
		console.log("[Webhook] Endpoint response:", response.status, responseText);

		if (!response.ok) {
			console.error("[Webhook] Failed to update record:", response.status, responseText);
		} else {
			console.log("[Webhook] Successfully updated to status:", newStatus);
		}

		return NextResponse.json({ received: true }, { status: 200 });
	} catch (err) {
		console.error("[Shufti Webhook] Unhandled error:", err);
		return NextResponse.json({ received: true }, { status: 200 });
	}
}
