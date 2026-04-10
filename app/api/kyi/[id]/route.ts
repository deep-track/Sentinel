import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const record = await prisma.kYIRecord.findUnique({
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

      const isAdmin = requestingUser?.role === "admin" || requestingUser?.role === "head";
      const isOwner = record.user.externalId === externalId;

      if (!isAdmin && !isOwner) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json({ status: 200, data: record });
  } catch (err) {
    console.error("[GET /api/kyi/:id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const record = await prisma.kYIRecord.update({
      where: { id },
      data: {
        status: body.status,
        shuftiEventType: body.shuftiEventType,
        extractedData: body.extractedData,
        verificationResult: body.verificationResult,
        declineReason: body.declineReason,
        reviewNotes: body.reviewNotes,
        reviewedAt:
          body.status === "approved" || body.status === "declined" ? new Date() : undefined,
      },
      include: { user: true },
    });

    return NextResponse.json({ status: 200, data: record });
  } catch (err) {
    console.error("[PATCH /api/kyi/:id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
