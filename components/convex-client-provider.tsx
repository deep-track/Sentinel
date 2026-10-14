"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ConvexReactClient, ConvexProviderWithAuth, useConvexAuth, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
  RELOGIN_STORAGE_KEY,
  buildReloginUrl,
  isReloginExemptPath,
  shouldAttemptRelogin,
} from "@/backend/lib/token-expiry";

let reloginInProgress = false;

function readLastReloginAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOGIN_STORAGE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeLastReloginAt(value: number | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(RELOGIN_STORAGE_KEY);
    else window.sessionStorage.setItem(RELOGIN_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable: reloginInProgress still stops repeat redirects.
  }
}

// The ID token expired while the session is still valid. Re-run /auth/login so
// silent Auth0 SSO issues a fresh one, at most once per RELOGIN_GUARD_MS; if it
// comes back expired again, stay signed out rather than looping.
function recoverExpiredToken() {
  if (reloginInProgress) return;
  const { pathname, search } = window.location;
  if (isReloginExemptPath(pathname)) return;
  const now = Date.now();
  if (!shouldAttemptRelogin(readLastReloginAt(), now)) {
    console.warn("[Convex] Auth token still expired after re-login; staying signed out.");
    return;
  }
  reloginInProgress = true;
  writeLastReloginAt(now);
  window.location.assign(buildReloginUrl(pathname, search));
}

function useAuthFromAuth0() {
  const [authState, setAuthState] = useState({
    isLoading: true,
    isAuthenticated: false,
  });

  // Always "no-store", whatever forceRefreshToken says: a cached response
  // would hand Convex the same expired token again.
  const fetchAccessToken = useCallback(
    async () => {
      try {
        const res = await fetch("/api/auth/token", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          token?: string | null;
          reason?: string;
        } | null;
        if (res.status === 401 && body?.reason === "expired") {
          recoverExpiredToken();
          return null;
        }
        if (!res.ok) return null;
        const token = body?.token ?? null;
        if (token) writeLastReloginAt(null);
        return token;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    fetchAccessToken().then((token) => {
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

// Saves the signed-in user's own name and email (from the verified ID token)
// so the Back Office can show names instead of Auth0 user ids. Once per page
// load; the mutation skips the write when nothing changed.
// It also accepts any team invitations waiting for this (verified) email, so
// an existing user invited to another organization gets it right away.
function RecordUserProfile() {
  const { isAuthenticated } = useConvexAuth();
  const recordMine = useMutation(anyApi.userProfiles.recordMine);
  const acceptMyInvites = useMutation(anyApi.team.acceptMyInvites);
  const [recorded, setRecorded] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || recorded) return;
    setRecorded(true);
    recordMine({}).catch(() => {
      // Display names only; never block the page.
    });
    acceptMyInvites({}).catch(() => {
      // Retried on the next page load.
    });
  }, [isAuthenticated, recorded, recordMine, acceptMyInvites]);
  return null;
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
      <RecordUserProfile />
      {children}
    </ConvexProviderWithAuth>
  );
}
