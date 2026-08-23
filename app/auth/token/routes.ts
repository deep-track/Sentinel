import { NextResponse } from "next/server";
import { getAuth0 } from "@/lib/auth0";

// This route exists purely to bridge Auth0's server-side session (kept in
// an encrypted cookie, never exposed to the browser directly) to Convex's
// client-side auth adapter. Convex calls this via fetchAccessToken() in
// components/convex-client-provider.tsx, then sends the token on the
// WebSocket connection; convex/auth.config.ts verifies it against the
// same AUTH0_DOMAIN/AUTH0_CLIENT_ID.
//
// NOTE: built against the documented @auth0/nextjs-auth0 v4
// Auth0Client.getAccessToken() API. Not verified against a live session
// yet (Auth0 is disabled locally via .env). Sanity-check this once real
// login is restored - if the SDK's return shape differs, this needs a
// one-line adjustment, not a rewrite.
export async function GET() {
  const { auth0, isAuth0Configured } = getAuth0();

  if (!isAuth0Configured || !auth0) {
    return NextResponse.json({ token: null }, { status: 200 });
  }

  try {
    const accessToken = await auth0.getAccessToken();
    return NextResponse.json({ token: accessToken?.accessToken ?? null });
  } catch (error) {
    console.error("[Convex Token Bridge] Failed to get Auth0 token:", error);
    return NextResponse.json({ token: null }, { status: 200 });
  }
}