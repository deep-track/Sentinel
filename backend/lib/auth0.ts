

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


let _auth0: any = null;
let _isAuth0Configured: boolean | null = null;
let _initialized = false;

export function getAuth0() {
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
			// Only import when needed (Node.js runtime)
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { Auth0Client } = require("@auth0/nextjs-auth0/server");
			_auth0 = new Auth0Client({
				secret: auth0Secret as string,
				appBaseUrl: appBaseUrl as string,
				domain: auth0Domain as string,
				clientId: auth0ClientId as string,
				clientSecret: auth0ClientSecret as string,
			});
			_initialized = true;
			console.log("[Auth0] Successfully initialized with domain:", auth0Domain);
		} catch (error) {
			console.error("[Auth0] Initialization error:", error);
			_auth0 = null;
		}
	} else if (!isConfigured && _initialized) {
		// Reset if vars become unavailable
		_auth0 = null;
		_initialized = false;
	}

	if (!isConfigured) {
		console.warn(
			"[Auth0] Not fully configured. Required: AUTH0_SECRET, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, APP_BASE_URL",
		);
	}

	return { auth0: _auth0, isAuth0Configured: isConfigured };
}
