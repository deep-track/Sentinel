// Shared by app/api/auth/token/route.ts (server) and
// components/convex-client-provider.tsx (browser). Keep this file free of
// imports so both sides, and tests/auth-token-expiry.integration.js, can load it.

// The Convex client refreshes shortly before exp; treat a token this close to
// expiry as already expired so Convex never receives one it will reject.
export const TOKEN_EXPIRY_SKEW_SECONDS = 60;

// Don't send the browser back to /auth/login more than once in this window. If
// silent SSO keeps returning a stale token we stop and stay signed out.
export const RELOGIN_GUARD_MS = 60_000;
export const RELOGIN_STORAGE_KEY = "sentinel:convex-relogin-at";

export function isTokenExpiring(
	exp: unknown,
	nowMs: number,
	skewSeconds = TOKEN_EXPIRY_SKEW_SECONDS,
): boolean {
	if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
	return exp * 1000 <= nowMs + skewSeconds * 1000;
}

// Pages that must never trigger a re-login redirect.
const NO_RELOGIN_ROUTES = ["/sign-in", "/logged-out", "/auth"];

export function isReloginExemptPath(pathname: string): boolean {
	if (pathname === "/" || pathname === "") return true;
	return NO_RELOGIN_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`),
	);
}

export function shouldAttemptRelogin(
	lastAttemptMs: number | null,
	nowMs: number,
): boolean {
	if (lastAttemptMs === null || !Number.isFinite(lastAttemptMs)) return true;
	return nowMs - lastAttemptMs >= RELOGIN_GUARD_MS;
}

export function buildReloginUrl(pathname: string, search: string): string {
	return `/auth/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
}
