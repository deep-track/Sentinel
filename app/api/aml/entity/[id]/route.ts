import { NextRequest, NextResponse } from "next/server";
import { getEntityById } from "@/lib/opensanctions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.trim().length === 0) {
      return NextResponse.json(
        { error: "Entity ID is required" },
        { status: 400 }
      );
    }

    const entity = await getEntityById(id);

    if (!entity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ status: 200, data: entity });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch entity";
    console.error("[AML entity]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
