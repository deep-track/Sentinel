# Sentinel Auth0 Role Claims Setup

## Purpose

Sentinel internal Convex operations require an approved Auth0 role claim. The accepted normalized roles are `admin`, `head`, `administrator`, `internal_admin`, `reviewer`, `compliance_analyst`, and `compliance_reviewer`.

## Action

Use `auth0/sentinel-role-claims-action.js` as a Post-Login Action in the `dev-08kwsss3wr77v0k0` development tenant. The Action reads only `event.authorization.roles`, filters to Sentinel-approved roles, normalizes spaces and hyphens to underscores, and writes the result to both the ID token and access token under:

```text
https://deeptrack.io/roles
https://deeptrack.io/role
```

The Action does not trust `user_metadata`, request parameters, or browser-provided role values.

## Auth0 deployment steps

In Auth0, open **Actions → Library**, create a **Post Login** Action named `Sentinel Role Claims`, paste the supplied script, and deploy it. Open the **Post Login** trigger, add the deployed Action to the flow, and apply the change. Assign the `administrator` or `compliance_analyst` role to the intended internal user through **User Management → Users → Roles** or the relevant organization membership workflow.

After changing a user’s role, require a new login so Auth0 issues fresh tokens. Existing tokens do not gain new claims retroactively.

## Verification

Decode a newly issued development ID/access token only in a secure local environment and confirm that the namespaced claims contain the expected normalized values. Do not paste the token into chat, GitHub, logs, or tickets.

An authenticated user with no approved role should still be able to authenticate but must receive `forbidden` from protected Convex internal operations. An authenticated user with `https://deeptrack.io/roles: ["compliance_analyst"]` or an approved administrator role should be allowed to read the monitoring query and use the protected internal operations that call `requireInternalUser`.

## Security controls

The action emits only the allowlisted roles. The Convex authorization helper independently validates the token claim and does not accept a role supplied in request JSON. Auth0 role assignment and Action deployment should be limited to authorized tenant administrators and recorded in the compliance change log.

## References

[1]: https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims "Auth0: Create Custom Claims"

[2]: https://auth0.com/docs/customize/actions/explore-triggers/post-login "Auth0: Post Login Actions"

[3]: https://auth0.com/docs/api/management/v2/actions/post-deploy-action "Auth0: Deploy an Action"
