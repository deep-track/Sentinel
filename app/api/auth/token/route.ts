import { decodeJwt } from "jose";
import { NextResponse } from "next/server";
import { getValidatedSession } from "@/backend/lib/auth";
import { isTokenExpiring } from "@/backend/lib/token-expiry";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function tokenExp(idToken: string): unknown {
  try {
    return decodeJwt(idToken).exp;
  } catch {
    return undefined;
  }
}

// Bridges the server-side Auth0 session (encrypted cookie) to the Convex
// client: returns the signed ID token that backend/convex/auth.config.ts
// verifies. getValidatedSession rejects undecryptable cookies and sessions
// issued for another Auth0 organization.
//
// The session can outlive its ID token and there is no refresh token to renew
// it here, so an expired (or nearly expired) token is reported as 401
// "expired". The client then re-runs /auth/login (silent SSO) instead of
// handing Convex a token it rejects, which leaves every query pending.
export async function GET() {
  try {
    const session = await getValidatedSession();
    const idToken = session?.tokenSet?.idToken ?? null;
    if (idToken && isTokenExpiring(tokenExp(idToken), Date.now())) {
      return NextResponse.json(
        { token: null, reason: "expired" },
        { status: 401, headers: NO_STORE },
      );
    }
    return NextResponse.json({ token: idToken }, { headers: NO_STORE });
  } catch (error) {
    console.error("[Convex Token Bridge] Failed to get Auth0 token:", error);
    return NextResponse.json(
      { token: null },
      { status: 200, headers: NO_STORE },
    );
  }
}
