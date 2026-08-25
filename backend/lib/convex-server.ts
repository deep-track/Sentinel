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

  // Convex's supported Auth0 adapter authenticates with the signed OIDC ID
  // token. Its `aud` claim is the Auth0 application client ID configured in
  // backend/convex/auth.config.ts.
  const session = await auth0.getSession();
  const idToken = session?.tokenSet?.idToken;
  if (!idToken) return null;

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(idToken);
  return client;
}
