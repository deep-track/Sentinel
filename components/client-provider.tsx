"use client";

import { ReactNode, useCallback, useMemo } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";

// Bridges Auth0's server-side session to Convex's generic auth adapter.
// Convex expects { isLoading, isAuthenticated, fetchAccessToken } - see
// https://docs.convex.dev/auth/advanced/custom-auth for the shape this
// implements. The actual token comes from app/api/auth/token/route.ts,
// since Auth0's SDK keeps it in an encrypted cookie, not accessible
// directly in client components.
function useAuthFromAuth0() {
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {URL
        const res = await fetch("/api/auth/token", {
          cache: forceRefreshToken ? "no-store" : "default",
        });
        if (!res.ok) return null;
        const { token } = await res.json();
        return token ?? null;
      } catch {
        return null;
      }
    },
    []
  );

  // NOTE: this reports isLoading: false / isAuthenticated: false as a
  // safe default rather than tracking real Auth0 session state client
  // side (no client-side Auth0 hook is wired up yet). Convex will treat
  // every request as unauthenticated until fetchAccessToken actually
  // resolves a token from a real logged-in session - which matches
  // reality while Auth0 is disabled locally. Once real login is
  // restored, this should be upgraded to track loading/session state
  // properly (e.g. via a useUser()-style hook) so Convex queries don't
  // fire before the session is known.
  return {
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken,
  };
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  const client = useMemo(() => {
    if (!convexUrl) {
      console.warn(
        "[Convex] NEXT_PUBLIC_CONVEX_URL is not set - Convex queries will not work. " +
          "This needs to be added to .env (ask Stacy for the deployment URL)."
      );
      return null;
    }
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    // Render children without Convex rather than crashing the whole app.
    // Any useQuery/useMutation call further down will throw its own
    // clear error about missing ConvexProvider context, which is more
    // useful for debugging than a blank page.
    return <>{children}</>;
  }

  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuth0}>
      {children}
    </ConvexProviderWithAuth>
  );
}