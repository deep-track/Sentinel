import { decodeJwt } from "jose";
import { NextResponse } from "next/server";
import { getValidatedSession } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";
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

function isUsable(idToken: string | null | undefined): idToken is string {
  return Boolean(idToken) && !isTokenExpiring(tokenExp(idToken as string), Date.now());
}

// Uses the session's refresh token (offline_access) to get a new ID token.
// getAccessToken({ refresh: true }) forces the grant even when the access
// token is still valid, and saves the new token set to the session cookie;
// re-reading the session then also re-applies the organization check.
async function refreshIdToken(): Promise<string | null> {
  const { auth0 } = getAuth0();
  if (!auth0) return null;
  try {
    await auth0.getAccessToken({ refresh: true });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.warn("[Convex Token Bridge] ID token refresh failed:", code ?? error);
    return null;
  }
  const refreshed = await getValidatedSession();
  const idToken = refreshed?.tokenSet?.idToken;
  return isUsable(idToken) ? idToken : null;
}

// Bridges the server-side Auth0 session (encrypted cookie) to the Convex
// client: returns the signed ID token that backend/convex/auth.config.ts
// verifies. getValidatedSession rejects undecryptable cookies and sessions
// issued for another Auth0 organization.
//
// The session can outlive its ID token. An expired (or nearly expired) token
// is renewed with the refresh token when the session has one. Otherwise (a
// session from before offline_access, or a failed refresh) it is reported as
// 401 "expired" and the client re-runs /auth/login (silent SSO) instead of
// handing Convex a token it rejects, which leaves every query pending.
export async function GET() {
  try {
    const session = await getValidatedSession();
    const idToken = session?.tokenSet?.idToken ?? null;
    if (idToken && !isUsable(idToken)) {
      const renewed = session?.tokenSet?.refreshToken ? await refreshIdToken() : null;
      if (renewed) {
        return NextResponse.json({ token: renewed }, { headers: NO_STORE });
      }
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
