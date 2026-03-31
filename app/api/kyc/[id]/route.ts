import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let externalId: string | null = null;
    try {
      const auth = await getAuth();
      externalId = auth?.userId ?? null;
    } catch {
      externalId = null;
    }

    const record = await prisma.kYCRecord.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (externalId) {
      const requestingUser = await prisma.user.findUnique({
        where: { externalId },
      });

      const isAdmin =
        requestingUser?.role === "admin" ||
        requestingUser?.role === "head";

      const isOwner = record.user.externalId === externalId;

      if (!isAdmin && !isOwner) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    // Ensure all fields are returned, even if null
    return NextResponse.json({
      status: 200,
      data: {
        ...record,
        // Explicitly include these so they're never undefined
        declinedCodes: record.declinedCodes ?? [],
        servicesDeclinedCodes: record.servicesDeclinedCodes ?? null,
        extractedData: record.extractedData ?? null,
        additionalData: record.additionalData ?? null,
        verificationResult: record.verificationResult ?? null,
        userName: record.userName || record.user?.fullName || null,
        userEmail: record.userEmail || record.user?.email || null,
      },
    });
  } catch (err) {
    console.error("[GET /api/kyc/:id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const record = await prisma.kYCRecord.update({
      where: { id },
      data: {
        status: body.status,
        shuftiEventType: body.shuftiEventType,
        extractedData: body.extractedData,
        verificationResult: body.verificationResult,
        declineReason: body.declineReason,
        declinedCodes: body.declinedCodes ?? [],
        servicesDeclinedCodes: body.servicesDeclinedCodes ?? undefined,
        additionalData: body.additionalData ?? undefined,
        reviewNotes: body.reviewNotes,
        reviewedAt: body.status === "approved" || body.status === "declined"
          ? new Date()
          : undefined,
      },
      include: { user: true },
    });

    // Ensure all fields are returned consistently
    return NextResponse.json({
      status: 200,
      data: {
        ...record,
        declinedCodes: record.declinedCodes ?? [],
        servicesDeclinedCodes: record.servicesDeclinedCodes ?? null,
        extractedData: record.extractedData ?? null,
        additionalData: record.additionalData ?? null,
        verificationResult: record.verificationResult ?? null,
        userName: record.userName || record.user?.fullName || null,
        userEmail: record.userEmail || record.user?.email || null,
      },
    });
  } catch (err) {
    console.error("[PATCH /api/kyc/:id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
