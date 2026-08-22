import { getAuth0 } from "@/lib/auth0";

export type AppRole = "user" | "admin" | "head";

export type AppUser = {
	id: string;
	email: string;
	fullName: string;
	role: AppRole;
	companyId?: string;
	picture?: string;
};

const ROLE_CLAIM = process.env.AUTH0_ROLE_CLAIM ?? "https://deeptrack.io/role";
const COMPANY_ID_CLAIM =
	process.env.AUTH0_COMPANY_ID_CLAIM ?? "https://deeptrack.io/companyId";

function isRecoverableSessionError(error: unknown) {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return (
		message.includes("jweinvalid") ||
		message.includes("invalid compact jwe") ||
		message.includes("decrypt") ||
		message.includes("session")
	);
}

async function safeGetSession() {
       const { auth0, isAuth0Configured } = getAuth0();
       if (!isAuth0Configured || !auth0) return null;

       try {
	       return await auth0.getSession();
       } catch (error) {
	       if (isRecoverableSessionError(error)) {
		       console.warn("Ignoring invalid Auth0 session cookie.");
		       return null;
	       }
	       throw error;
       }
}

function getClaimValue(user: Record<string, unknown>, key: string) {
	return user[key];
}

function getRole(user: Record<string, unknown>): AppRole {
	const roleFromCustomClaim = getClaimValue(user, ROLE_CLAIM);

	if (typeof roleFromCustomClaim === "string") {
		if (roleFromCustomClaim === "admin" || roleFromCustomClaim === "head") {
			return roleFromCustomClaim;
		}
		// Auth0 production uses the explicit Sentinel role name. Preserve the
		// existing application contract while recognizing the production claim.
		if (roleFromCustomClaim === "administrator") return "admin";
		return "user";
	}

	if (Array.isArray(roleFromCustomClaim)) {
		if (roleFromCustomClaim.includes("head")) return "head";
		if (roleFromCustomClaim.includes("admin") || roleFromCustomClaim.includes("administrator")) {
			return "admin";
		}
	}

	const fallbackRole = getClaimValue(user, "role");
	if (fallbackRole === "admin" || fallbackRole === "head") return fallbackRole;
	if (fallbackRole === "administrator") return "admin";

	return "user";
}

function getCompanyId(user: Record<string, unknown>) {
	const fromClaim = getClaimValue(user, COMPANY_ID_CLAIM);
	if (typeof fromClaim === "string" && fromClaim.length > 0) return fromClaim;

	const fromAppMetadata = getClaimValue(user, "app_metadata");
	if (
		fromAppMetadata &&
		typeof fromAppMetadata === "object" &&
		"companyId" in fromAppMetadata &&
		typeof fromAppMetadata.companyId === "string"
	) {
		return fromAppMetadata.companyId;
	}

	return undefined;
}

export async function getAuth() {
	const session = await safeGetSession();
	return { userId: session?.user?.sub ?? null };
}

export async function getCurrentUser(): Promise<AppUser | null> {
	const session = await safeGetSession();
	if (!session?.user?.sub) return null;

	const rawUser = session.user as Record<string, unknown>;
	const email =
		typeof rawUser.email === "string"
			? rawUser.email
			: `${session.user.sub}@users.deeptrack.local`;

	const fullName =
		typeof rawUser.name === "string"
			? rawUser.name
			: typeof rawUser.nickname === "string"
				? rawUser.nickname
				: email;

	return {
		id: session.user.sub,
		email,
		fullName,
		role: getRole(rawUser),
		companyId: getCompanyId(rawUser),
		picture:
			typeof rawUser.picture === "string" ? rawUser.picture : undefined,
	};
}
