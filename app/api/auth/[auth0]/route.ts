import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Get the redirect URL from query params or default to logged-out
  const redirectUrl = request.nextUrl.searchParams.get("redirect") || "/logged-out";

  // Build Auth0 logout URL
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const auth0ClientId = process.env.AUTH0_CLIENT_ID;

  if (!auth0Domain || !auth0ClientId) {
    return NextResponse.redirect(redirectUrl);
  }

  const logoutUrl = new URL(`https://${auth0Domain}/v2/logout`);
  logoutUrl.searchParams.set("client_id", auth0ClientId);
  logoutUrl.searchParams.set("returnTo", `${request.nextUrl.origin}${redirectUrl}`);
  return NextResponse.redirect(logoutUrl.toString());
}
