import { NextResponse } from "next/server";
import { getValidatedSession } from "@/backend/lib/auth";

export const dynamic = "force-dynamic";

// Bridges the server-side Auth0 session (encrypted cookie) to the Convex
// client: returns the signed ID token that backend/convex/auth.config.ts
// verifies. getValidatedSession rejects undecryptable cookies and sessions
// issued for another Auth0 organization.
export async function GET() {
  try {
    const session = await getValidatedSession();
    return NextResponse.json(
      { token: session?.tokenSet?.idToken ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[Convex Token Bridge] Failed to get Auth0 token:", error);
    return NextResponse.json(
      { token: null },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
