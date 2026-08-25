import { NextResponse } from "next/server";
import { getAuth0 } from "@/backend/lib/auth0";

export async function GET() {
  const { auth0, isAuth0Configured } = getAuth0();

  if (!isAuth0Configured || !auth0) {
    return NextResponse.json({ token: null }, { status: 200 });
  }

  try {
    const audience = process.env.AUTH0_CLIENT_ID?.trim();
    const accessToken = await auth0.getAccessToken(
      audience ? { audience } : undefined,
    );

    return NextResponse.json({ token: accessToken?.token ?? null });
  } catch (error) {
    console.error("[Convex Token Bridge] Failed to get Auth0 token:", error);
    return NextResponse.json({ token: null }, { status: 200 });
  }
}
