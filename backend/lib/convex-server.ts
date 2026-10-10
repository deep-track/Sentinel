import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { getAuth0 } from "@/backend/lib/auth0";
import { getValidatedSession } from "@/backend/lib/auth";

function getConvexUrl() {
  const value = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  return value || null;
}

export type ConvexClientResult =
  | { status: "ok"; client: ConvexHttpClient }
  // Convex URL or Auth0 is not configured on this deployment.
  | { status: "not_configured" }
  // Configuration is fine but there is no valid signed-in session.
  | { status: "unauthenticated" };

export async function getConvexClientForCurrentUser(): Promise<ConvexClientResult> {
  const convexUrl = getConvexUrl();
  const { auth0, isAuth0Configured } = getAuth0();
  if (!convexUrl || !isAuth0Configured || !auth0) return { status: "not_configured" };

  // Convex's supported Auth0 adapter authenticates with the signed OIDC ID
  // token. Its `aud` claim is the Auth0 application client ID configured in
  // backend/convex/auth.config.ts. getValidatedSession also rejects
  // undecryptable cookies and sessions from another Auth0 organization.
  const session = await getValidatedSession();
  const idToken = session?.tokenSet?.idToken;
  if (!idToken) return { status: "unauthenticated" };

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(idToken);
  return { status: "ok", client };
}

export async function getAuthenticatedConvexClient() {
  const result = await getConvexClientForCurrentUser();
  return result.status === "ok" ? result.client : null;
}

// Maps a Convex authorization error to an HTTP status for API routes.
export function convexAuthErrorStatus(error: unknown): 401 | 403 | null {
  if (!(error instanceof ConvexError)) return null;
  const code = (error.data as { code?: unknown } | null)?.code;
  if (code === "unauthenticated") return 401;
  if (code === "forbidden") return 403;
  return null;
}
