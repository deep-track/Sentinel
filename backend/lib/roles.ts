// Client-safe role model for the Next.js layer. This module must not import
// any server-only code so client components (e.g. the sidebar) can share it.
//
// Auth0 roles are emitted by auth0/sentinel-role-claims-action.js under the
// namespaced `https://deeptrack.io/roles` array claim. Every Auth0 role is an
// internal (DeepTrack staff) role; customer roles live in Convex
// `clientMembers`. The mapping below mirrors backend/convex/lib/rbac.ts:
//   - admin, head, administrator, internal_admin -> internal administrators
//   - reviewer, compliance_analyst, compliance_reviewer -> internal reviewers
//   - view_only -> modifier that removes write access for internal admins

export type AppRole = "user" | "admin" | "head" | "internal_admin" | "reviewer";

export const DEFAULT_ROLES_CLAIM = "https://deeptrack.io/roles";
export const DEFAULT_COMPANY_ID_CLAIM = "https://deeptrack.io/companyId";

// Highest privilege first. getRoleFromClaims picks the first match, so the
// result never depends on the order of roles inside the claim array.
const ROLE_PRIORITY: ReadonlyArray<readonly [AppRole, readonly string[]]> = [
	["internal_admin", ["internal_admin", "administrator"]],
	["head", ["head"]],
	["admin", ["admin"]],
	["reviewer", ["reviewer", "compliance_analyst", "compliance_reviewer"]],
];

const INTERNAL_ADMIN_APP_ROLES: readonly AppRole[] = ["internal_admin", "head", "admin"];
const INTERNAL_OPS_APP_ROLES: readonly AppRole[] = [
	...INTERNAL_ADMIN_APP_ROLES,
	"reviewer",
];

export function normalizeRoleName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
	return normalized.length > 0 ? normalized : null;
}

export function collectRoleNames(values: unknown[]): Set<string> {
	const names = new Set<string>();
	for (const value of values) {
		const candidates = Array.isArray(value) ? value : [value];
		for (const candidate of candidates) {
			const role = normalizeRoleName(candidate);
			if (role) names.add(role);
		}
	}
	return names;
}

export function getRoleFromNames(roleNames: Set<string>): AppRole {
	for (const [appRole, sources] of ROLE_PRIORITY) {
		if (sources.some((source) => roleNames.has(source))) return appRole;
	}
	return "user";
}

export function isInternalOpsRole(role: AppRole): boolean {
	return INTERNAL_OPS_APP_ROLES.includes(role);
}

export function isInternalAdminRole(role: AppRole): boolean {
	return INTERNAL_ADMIN_APP_ROLES.includes(role);
}
