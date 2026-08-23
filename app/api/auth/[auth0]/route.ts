import { NextRequest, NextResponse } from "next/server";

function normalizeAuth0Domain(value: string) {
  const domain = value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain || domain.includes("/") || domain.includes("\\")) return null;
  return domain;
}

function getSafeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/logged-out";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const returnPath = getSafeReturnPath(
    request.nextUrl.searchParams.get("redirect"),
  );
  const localReturnUrl = new URL(returnPath, request.nextUrl.origin);
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const auth0ClientId = process.env.AUTH0_CLIENT_ID;

  if (!auth0Domain || !auth0ClientId) {
    return NextResponse.redirect(localReturnUrl);
  }

  const normalizedDomain = normalizeAuth0Domain(auth0Domain);
  if (!normalizedDomain) {
    return NextResponse.redirect(localReturnUrl);
  }

  const logoutUrl = new URL(`https://${normalizedDomain}/v2/logout`);
  logoutUrl.searchParams.set("client_id", auth0ClientId);
  logoutUrl.searchParams.set("returnTo", localReturnUrl.toString());
  return NextResponse.redirect(logoutUrl);
}
