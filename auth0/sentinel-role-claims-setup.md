# Sentinel Auth0 Role Claims Setup

## Purpose

Sentinel internal Convex operations and the Next.js internal-ops area require an approved Auth0 role claim. The accepted normalized roles are:

| Auth0 role | Meaning in Sentinel |
|---|---|
| `internal_admin`, `administrator` | Internal administrator (all tenants) |
| `head`, `admin` | Internal administrator in Convex; in the Next.js invitation flow they are limited to the company in their `companyId` claim |
| `reviewer`, `compliance_analyst`, `compliance_reviewer` | Internal reviewer (internal-ops read and review access, no administrator rights) |
| `view_only` | Modifier: an administrator with this role can read but cannot make changes |

Customer roles (`client_admin`, `compliance_analyst`, `developer`, `viewer`) are **not** Auth0 roles. They live in the Convex `clientMembers` table.

## Action

Use `auth0/sentinel-role-claims-action.js` as a Post-Login Action in the Sentinel Auth0 tenant. The Action reads only `event.authorization.roles`, filters to Sentinel-approved roles, normalizes spaces and hyphens to underscores, and writes the result to both the ID token and access token under:

```text
https://deeptrack.io/roles      (canonical array claim)
https://deeptrack.io/role       (legacy: the single highest-privilege role)
https://deeptrack.io/companyId  (only when the user's app_metadata.companyId is set)
```

Applications should read the `/roles` array. Set `AUTH0_ROLE_CLAIM=https://deeptrack.io/roles` in the Next.js environment. The Next.js layer picks the highest-privilege role from the array, so the order of the array does not matter.

The Action does not trust `user_metadata`, request parameters, or browser-provided role values. `companyId` comes from `app_metadata`, which only tenant administrators and the Management API can write. Organization invitations created by Sentinel store `companyId` in the invitation's `app_metadata`, which Auth0 copies to the user when they accept.

## Auth0 deployment steps

In Auth0, open **Actions → Library**, create a **Post Login** Action named `Sentinel Role Claims`, paste the supplied script, and deploy it. Open the **Post Login** trigger, add the deployed Action to the flow, and apply the change. Assign the `administrator` or `compliance_analyst` role to the intended internal user through **User Management → Users → Roles** or the relevant organization membership workflow. Assign `view_only` in addition to an administrator role for read-only administrators.

After changing a user's role, require a new login so Auth0 issues fresh tokens. Existing tokens do not gain new claims retroactively.

## Verification

Decode a newly issued ID/access token only in a secure local environment and confirm that the namespaced claims contain the expected normalized values. Do not paste the token into chat, GitHub, logs, or tickets.

An authenticated user with no approved role should still be able to authenticate but must receive `forbidden` from protected Convex internal operations. An authenticated user with `https://deeptrack.io/roles: ["compliance_analyst"]` or an approved administrator role should be allowed to read the monitoring query and use the protected internal operations that call `requireInternalUser`. A user whose roles include `view_only` must be denied every write.

## Security controls

The action emits only the allowlisted roles. The Convex authorization helper (`backend/convex/lib/rbac.ts`) and the Next.js helper (`backend/lib/roles.ts`) independently validate the token claim and do not accept a role supplied in request JSON. Keep the allowlist in this Action in sync with both files. Auth0 role assignment and Action deployment should be limited to authorized tenant administrators and recorded in the compliance change log.

## References

[1]: https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims "Auth0: Create Custom Claims"

[2]: https://auth0.com/docs/customize/actions/explore-triggers/post-login "Auth0: Post Login Actions"

[3]: https://auth0.com/docs/api/management/v2/actions/post-deploy-action "Auth0: Deploy an Action"
