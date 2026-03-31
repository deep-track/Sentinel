import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

// GET /api/kyc — list records (admin)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const requestedUserId = searchParams.get("userId");

    let externalId: string | null = null;
    let userRole: string = "user";

    try {
      const auth = await getAuth();
      externalId = auth?.userId ?? null;
    } catch {
      externalId = null;
    }

    if (!externalId) {
      externalId = requestedUserId ?? null;
    }

    if (!externalId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { externalId },
    });

    if (!user) {
      return NextResponse.json({ status: 200, data: { records: [], total: 0 } });
    }

    userRole = user.role;
    const isAdmin = userRole === "admin" || userRole === "head";

    const where = {
      ...(status ? { status } : {}),
      ...(!isAdmin ? { userId: user.id } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.kYCRecord.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.kYCRecord.count({ where }),
    ]);

    const mappedRecords = records.map((r: typeof records[number]) => ({
      ...r,
      userName: r.userName || r.user?.fullName || r.user?.email?.split("@")[0] || "Unknown",
      userEmail: r.userEmail || r.user?.email || "",
    }));

    return NextResponse.json({ status: 200, data: { records: mappedRecords, total } });
  } catch (err) {
    console.error("[GET /api/kyc]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST /api/kyc — create KYC record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Try Auth0 session first, fall back to userId in body
    let externalId: string | null = null;

    try {
      const auth = await getAuth();
      externalId = auth?.userId ?? null;
    } catch {
      externalId = null;
    }

    // Fall back to userId sent in body from server action
    if (!externalId) {
      externalId = body.userId ?? null;
    }

    if (!externalId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let user = await prisma.user.findUnique({
      where: { externalId },
      include: { headOf: true, memberships: true },
    });

    // Auto-create user if they exist in Auth0 but not DB yet
    if (!user && body.userEmail) {
      user = await prisma.user.create({
        data: {
          externalId,
          email: body.userEmail,
          fullName: body.userName ?? "",
          role: "user",
        },
        include: { headOf: true, memberships: true },
      });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const orgId =
      user.headOf?.id ?? user.memberships[0]?.organizationId ?? null;

    const record = await prisma.kYCRecord.create({
      data: {
        reference: body.reference,
        userId: user.id,
        organizationId: orgId,
        status: body.status ?? "processing",
        userEmail: body.userEmail ?? user.email ?? "",
        userName: body.userName ?? user.fullName ?? "",
        documentType: body.documentType,
        documentFrontUrl: body.documentFrontUrl,
        documentBackUrl: body.documentBackUrl,
        selfieUrl: body.selfieUrl,
        extractedData: body.extractedData,
        verificationResult: body.verificationResult,
        shuftiEventType: body.shuftiEventType,
        shuftiVerificationUrl: body.shuftiVerificationUrl,
        submittedAt: new Date(),
      },
    });

    return NextResponse.json({ status: 200, data: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/kyc] FULL ERROR:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
