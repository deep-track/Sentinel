import { ConvexHttpClient } from "convex/browser";
import { getAuth0 } from "@/lib/auth0";

function getConvexUrl() {
  const value = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  return value || null;
}

export async function getAuthenticatedConvexClient() {
  const convexUrl = getConvexUrl();
  const { auth0 } = getAuth0();
  if (!convexUrl || !auth0) return null;

  const accessToken = await auth0.getAccessToken();
  if (!accessToken?.accessToken) return null;

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(accessToken.accessToken);
  return client;
}
