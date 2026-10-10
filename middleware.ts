export const runtime = "nodejs";

import { getAuth0, getConfiguredOrganizationId } from "@/backend/lib/auth0";
import { isRecoverableSessionError } from "@/backend/lib/auth-errors";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Routes that skip the Auth0 SDK middleware entirely (no rolling-session
// cookie refresh). This middleware never enforces authentication itself:
// protected pages and API routes check the session server-side. Matching is
// exact or on a path-segment boundary, so "/sign-in-foo" is not public.
const PUBLIC_ROUTES = ["/sign-in", "/logged-out"];

function isPublicRoute(pathname: string): boolean {
	return PUBLIC_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`),
	);
}

function clearSessionCookies(request: NextRequest, response: NextResponse) {
	for (const cookie of request.cookies.getAll()) {
		const isSessionCookie =
			cookie.name === "__session" ||
			cookie.name.startsWith("__session__") ||
			cookie.name === "appSession" ||
			cookie.name.startsWith("appSession.");
		if (isSessionCookie) {
			response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
		}
	}
	return response;
}

export async function middleware(request: NextRequest) {
	const { auth0, isAuth0Configured } = getAuth0();
	if (!isAuth0Configured || !auth0) {
		return NextResponse.next();
	}

	if (isPublicRoute(request.nextUrl.pathname)) {
		return NextResponse.next();
	}

	try {
		// Auth0 Business Users applications require an organization on login.
		// Always pin it to the configured organization so a caller cannot pick
		// a different one via ?organization=.
		const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
		if (pathname === "/auth/login") {
			const organizationId = getConfiguredOrganizationId();
			if (!organizationId) {
				return NextResponse.json(
					{ error: "B2B organization login is not configured" },
					{ status: 503 },
				);
			}
			request.nextUrl.searchParams.set("organization", organizationId);
		}

		// Awaited so that errors from the SDK are caught below.
		return await auth0.middleware(request);
	} catch (error) {
		if (!isRecoverableSessionError(error)) {
			throw error;
		}

		// The session cookie cannot be decrypted or has expired: drop it and
		// continue as a logged-out request instead of failing every page.
		return clearSessionCookies(request, NextResponse.next());
	}
}

export const config = {
	matcher: [
		// Skip Next.js internals and all static files, unless found in search params
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
