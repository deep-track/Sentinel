import {
	Auth0Client,
	filterDefaultIdTokenClaims,
} from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import {
	DEFAULT_COMPANY_ID_CLAIM,
	DEFAULT_ROLES_CLAIM,
} from "@/backend/lib/roles";

function getEnv(name: string) {
	const value = process.env[name];
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function normalizeDomain(domain?: string) {
	if (!domain) return undefined;
	if (domain.startsWith("http://") || domain.startsWith("https://")) {
		try {
			return new URL(domain).hostname;
		} catch {
			return undefined;
		}
	}
	return domain;
}

function normalizeAppBaseUrl(url?: string) {
	if (!url) return undefined;
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

export function getRoleClaimName() {
	return getEnv("AUTH0_ROLE_CLAIM") ?? DEFAULT_ROLES_CLAIM;
}

export function getCompanyIdClaimName() {
	return getEnv("AUTH0_COMPANY_ID_CLAIM") ?? DEFAULT_COMPANY_ID_CLAIM;
}

export function getConfiguredOrganizationId() {
	return getEnv("AUTH0_ORGANIZATION_ID");
}

// Custom (namespaced) claims that must survive into session.user. Auth0 SDK
// v4 otherwise keeps only the default OIDC claims, which silently drops the
// role and company claims the Next.js layer relies on.
function getPreservedCustomClaims(): string[] {
	return [
		...new Set([
			getRoleClaimName(),
			DEFAULT_ROLES_CLAIM,
			getCompanyIdClaimName(),
		]),
	];
}

async function beforeSessionSaved(session: SessionData): Promise<SessionData> {
	const rawUser = session.user as Record<string, unknown>;
	const user = filterDefaultIdTokenClaims(rawUser) as Record<string, unknown>;
	for (const claim of getPreservedCustomClaims()) {
		if (claim in rawUser) user[claim] = rawUser[claim];
	}
	return { ...session, user: user as SessionData["user"] };
}

let _auth0: Auth0Client | null = null;
let _initialized = false;
let _warnedUnconfigured = false;

export function getAuth0(): {
	auth0: Auth0Client | null;
	isAuth0Configured: boolean;
} {
	// Always attempt to read environment variables - don't cache failed attempts
	const auth0Secret = getEnv("AUTH0_SECRET");
	const appBaseUrl = normalizeAppBaseUrl(
		getEnv("APP_BASE_URL") ?? getEnv("NEXT_PUBLIC_APP_URL"),
	);
	const auth0Domain = normalizeDomain(getEnv("AUTH0_DOMAIN"));
	const auth0ClientId = getEnv("AUTH0_CLIENT_ID");
	const auth0ClientSecret = getEnv("AUTH0_CLIENT_SECRET");

	const isConfigured =
		Boolean(auth0Secret) &&
		Boolean(appBaseUrl) &&
		Boolean(auth0Domain) &&
		Boolean(auth0ClientId) &&
		Boolean(auth0ClientSecret);

	// Only initialize Auth0 client once all vars are available
	if (isConfigured && !_initialized) {
		try {
			_auth0 = new Auth0Client({
				secret: auth0Secret as string,
				appBaseUrl: appBaseUrl as string,
				domain: auth0Domain as string,
				clientId: auth0ClientId as string,
				clientSecret: auth0ClientSecret as string,
				authorizationParameters: {
					scope: "openid profile email",
				},
				beforeSessionSaved,
			});
			_initialized = true;
			_warnedUnconfigured = false;
		} catch (error) {
			console.error("[Auth0] Initialization error:", error);
			_auth0 = null;
		}
	} else if (!isConfigured && _initialized) {
		// Reset if vars become unavailable
		_auth0 = null;
		_initialized = false;
	}

	if (!isConfigured && !_warnedUnconfigured) {
		_warnedUnconfigured = true;
		console.warn(
			"[Auth0] Not fully configured. Required: AUTH0_SECRET, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, APP_BASE_URL",
		);
	}

	return { auth0: _auth0, isAuth0Configured: isConfigured };
}
