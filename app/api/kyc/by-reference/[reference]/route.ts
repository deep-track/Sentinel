import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const body = await req.json();

    console.log("[by-reference PATCH] ===== START =====");
    console.log("[by-reference PATCH] reference:", reference);
    console.log("[by-reference PATCH] body.status:", body.status);
    console.log("[by-reference PATCH] body.declinedCodes:", body.declinedCodes);
    console.log("[by-reference PATCH] has body.extractedData:", !!body.extractedData);
    console.log("[by-reference PATCH] has body.additionalData:", !!body.additionalData);
    console.log("[by-reference PATCH] has body.servicesDeclinedCodes:", !!body.servicesDeclinedCodes);

    // Verify the record exists first
    const existing = await prisma.kYCRecord.findUnique({
      where: { reference },
    });

    if (!existing) {
      console.error("[by-reference PATCH] Record not found:", reference);
      return NextResponse.json(
        { error: "KYC record not found" },
        { status: 404 }
      );
    }

    console.log("[by-reference PATCH] Found record id:", existing.id);
    console.log("[by-reference PATCH] Current declinedCodes:", existing.declinedCodes);

    const record = await prisma.kYCRecord.update({
      where: { reference },
      data: {
        status: body.status ?? existing.status,
        shuftiEventType: body.shuftiEventType ?? existing.shuftiEventType,
        declineReason: body.declineReason ?? existing.declineReason,
        // Save declined codes array
        declinedCodes: Array.isArray(body.declinedCodes)
          ? body.declinedCodes
          : [],
        // Save per-service codes
        servicesDeclinedCodes: body.servicesDeclinedCodes ?? existing.servicesDeclinedCodes,
        // Save standard OCR data
        extractedData: body.extractedData ?? existing.extractedData,
        // Save enhanced OCR data
        additionalData: body.additionalData ?? existing.additionalData,
        verificationResult:
          body.verificationResult ?? existing.verificationResult,
        // Set reviewedAt when terminal status reached
        reviewedAt:
          body.status === "approved" || body.status === "declined"
            ? new Date()
            : existing.reviewedAt,
      },
    });

    console.log("[by-reference PATCH] Updated successfully");
    console.log("[by-reference PATCH] saved declinedCodes:", record.declinedCodes);
    console.log("[by-reference PATCH] new status:", record.status);
    console.log("[by-reference PATCH] ===== END =====")

    return NextResponse.json({ status: 200, data: record });
  } catch (err) {
    console.error("[KYC by-reference PATCH] Error:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
