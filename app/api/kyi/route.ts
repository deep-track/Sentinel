import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const investorType = searchParams.get("investorType");
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const requestedUserId = searchParams.get("userId");

    let externalId: string | null = null;

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

    const isAdmin = user.role === "admin" || user.role === "head";

    const where = {
      ...(status ? { status } : {}),
      ...(investorType ? { investorType } : {}),
      ...(!isAdmin ? { userId: user.id } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.kYIRecord.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.kYIRecord.count({ where }),
    ]);

    const mappedRecords = records.map((r: typeof records[number]) => ({
      ...r,
      userName: r.userName || r.user?.fullName || r.user?.email?.split("@")[0] || "Unknown",
      userEmail: r.userEmail || r.user?.email || "",
    }));

    return NextResponse.json({ status: 200, data: { records: mappedRecords, total } });
  } catch (err) {
    console.error("[GET /api/kyi]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let externalId: string | null = null;

    try {
      const auth = await getAuth();
      externalId = auth?.userId ?? null;
    } catch {
      externalId = null;
    }

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

    const orgId = user.headOf?.id ?? user.memberships[0]?.organizationId ?? null;

    const record = await prisma.kYIRecord.create({
      data: {
        reference: body.reference,
        userId: user.id,
        organizationId: orgId,
        status: body.status ?? "processing",
        userEmail: body.userEmail ?? user.email ?? "",
        userName: body.userName ?? user.fullName ?? "",
        isPEP: body.isPEP ?? false,
        accreditationStatus: body.accreditationStatus,
        investorType: body.investorType,
        investmentAmount: body.investmentAmount,
        investmentCurrency: body.investmentCurrency,
        sourceOfFunds: body.sourceOfFunds,
        governmentIdType: body.governmentIdType,
        governmentIdUrl: body.governmentIdUrl,
        selfieUrl: body.selfieUrl,
        bankStatementUrl: body.bankStatementUrl,
        proofOfAddressUrl: body.proofOfAddressUrl,
        proofOfNetWorthUrl: body.proofOfNetWorthUrl,
        accreditationLetterUrl: body.accreditationLetterUrl,
        sourceOfFundsDocUrl: body.sourceOfFundsDocUrl,
        corporateDocUrl: body.corporateDocUrl,
        extractedData: body.extractedData,
        verificationResult: body.verificationResult,
        shuftiEventType: body.shuftiEventType,
        submittedAt: new Date(),
      },
    });

    return NextResponse.json({ status: 200, data: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/kyi] FULL ERROR:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
