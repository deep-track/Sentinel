import { ConvexHttpClient } from "convex/browser";
import { getAuth0 } from "@/backend/lib/auth0";

function getConvexUrl() {
  const value = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  return value || null;
}

export async function getAuthenticatedConvexClient() {
  const convexUrl = getConvexUrl();
  const { auth0 } = getAuth0();
  if (!convexUrl || !auth0) return null;

  const auth0Audience = process.env.AUTH0_CLIENT_ID?.trim();
  if (!auth0Audience) return null;

  // Convex validates the JWT audience against `applicationID` in
  // convex/auth.config.ts. Requesting the default Auth0 token can return an
  // opaque/session token that Convex cannot authenticate.
  const accessToken = await auth0.getAccessToken({ audience: auth0Audience });
  if (!accessToken?.token) return null;

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(accessToken.token);
  return client;
}
