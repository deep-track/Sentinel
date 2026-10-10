import type { SessionData } from "@auth0/nextjs-auth0/types";
import { decodeJwt } from "jose";
import {
	getAuth0,
	getCompanyIdClaimName,
	getConfiguredOrganizationId,
	getRoleClaimName,
} from "@/backend/lib/auth0";
import { isRecoverableSessionError } from "@/backend/lib/auth-errors";
import {
	type AppRole,
	DEFAULT_ROLES_CLAIM,
	collectRoleNames,
	getRoleFromNames,
	isInternalAdminRole,
	isInternalOpsRole,
} from "@/backend/lib/roles";

export type { AppRole };
export { isInternalAdminRole, isInternalOpsRole };

export type AppUser = {
	id: string;
	email: string;
	fullName: string;
	role: AppRole;
	// True when the user carries the Auth0 `view_only` role: they may read
	// but must not perform administrative writes (mirrors rbac.ts).
	viewOnly: boolean;
	companyId?: string;
	picture?: string;
};

function sessionMatchesOrganization(session: SessionData) {
	const expectedOrgId = getConfiguredOrganizationId();
	if (!expectedOrgId) return true;
	return session.user?.org_id === expectedOrgId;
}

/**
 * Returns the current Auth0 session, or null when there is no usable session.
 *
 * A session is treated as absent when:
 *  - Auth0 is not configured,
 *  - the cookie cannot be decrypted or has expired, or
 *  - AUTH0_ORGANIZATION_ID is set and the session was issued for a different
 *    organization (or none).
 */
export async function getValidatedSession(): Promise<SessionData | null> {
	const { auth0, isAuth0Configured } = getAuth0();
	if (!isAuth0Configured || !auth0) return null;

	let session: SessionData | null;
	try {
		session = await auth0.getSession();
	} catch (error) {
		if (isRecoverableSessionError(error)) {
			console.warn("[auth] Ignoring invalid Auth0 session cookie.");
			return null;
		}
		throw error;
	}

	if (!session?.user?.sub) return null;
	if (!sessionMatchesOrganization(session)) {
		console.warn("[auth] Rejecting session issued for an unexpected Auth0 organization.");
		return null;
	}
	return session;
}

// Claims are normally on session.user (kept by beforeSessionSaved in
// backend/lib/auth0.ts). Sessions created before that hook existed had them
// stripped, so fall back to the ID token stored in the session. The session
// cookie is encrypted with AUTH0_SECRET and the token was validated by the SDK
// at login, so decoding it here does not trust unverified input.
function getClaims(session: SessionData): Record<string, unknown> {
	const user = session.user as Record<string, unknown>;
	const customClaims = [getRoleClaimName(), DEFAULT_ROLES_CLAIM, getCompanyIdClaimName()];
	if (customClaims.some((claim) => claim in user)) return user;

	const idToken = session.tokenSet?.idToken;
	if (!idToken) return user;
	try {
		const tokenClaims = decodeJwt(idToken) as Record<string, unknown>;
		if (tokenClaims.sub !== user.sub) return user;
		const merged: Record<string, unknown> = { ...user };
		for (const claim of customClaims) {
			if (claim in tokenClaims) merged[claim] = tokenClaims[claim];
		}
		return merged;
	} catch {
		return user;
	}
}

function getRoleNames(user: Record<string, unknown>) {
	return collectRoleNames([user[getRoleClaimName()], user[DEFAULT_ROLES_CLAIM]]);
}

function getCompanyId(user: Record<string, unknown>) {
	const fromClaim = user[getCompanyIdClaimName()];
	if (typeof fromClaim === "string" && fromClaim.length > 0) return fromClaim;
	return undefined;
}

export async function getAuth() {
	const session = await getValidatedSession();
	return { userId: session?.user?.sub ?? null };
}

export async function getCurrentUser(): Promise<AppUser | null> {
	const session = await getValidatedSession();
	if (!session) return null;

	const rawUser = getClaims(session);
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

	const roleNames = getRoleNames(rawUser);

	return {
		id: session.user.sub,
		email,
		fullName,
		role: getRoleFromNames(roleNames),
		viewOnly: roleNames.has("view_only"),
		companyId: getCompanyId(rawUser),
		picture:
			typeof rawUser.picture === "string" ? rawUser.picture : undefined,
	};
}
