"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";

function useAuthFromAuth0() {
  const [authState, setAuthState] = useState({
    isLoading: true,
    isAuthenticated: false,
  });

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
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
    [],
  );

  useEffect(() => {
    let active = true;
    fetchAccessToken({ forceRefreshToken: false }).then((token) => {
      if (active) {
        setAuthState({
          isLoading: false,
          isAuthenticated: Boolean(token),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [fetchAccessToken]);

  return { ...authState, fetchAccessToken };
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  const client = useMemo(() => {
    if (!convexUrl) {
      console.warn(
        "[Convex] NEXT_PUBLIC_CONVEX_URL is not set - Convex queries will not work.",
      );
      return null;
    }
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) return <>{children}</>;

  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuth0}>
      {children}
    </ConvexProviderWithAuth>
  );
}
