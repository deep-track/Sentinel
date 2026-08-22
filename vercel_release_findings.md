# Sentinel Production Release Findings

## Deployment

- Sentinel Vercel project: https://vercel.com/deeptracks-projects-32338107/sentinel
- Production environment variables were added successfully in the authenticated Vercel project and are marked Production: `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, and `CONVEX_SITE_URL`.
- Convex deployment values used: `https://insightful-lark-924.convex.cloud`, `insightful-lark-924`, and `https://insightful-lark-924.convex.site`.
- Existing Auth0 variables were verified as present in Vercel in masked form: `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID`, `AUTH0_DOMAIN`, and `APP_BASE_URL`. No secret values were recorded.
- Vercel reported that the production redeployment was created.
- The public custom domain `https://sentinel.deeptrack.io` served the Sentinel landing page successfully.

## Production Auth0 Configuration

- Correct production Auth0 tenant: `dev-08kwsss3wr77v0k0`.
- Production Sentinel application: `Sentinel`, Regular Web Application.
- Production application client ID: `WTWmrqUgoRecLED5EsnV1g7A0DyZrcgK`.
- Login Experience is configured as **Business Users** with **Prompt for Credentials**. This preserves the requirement that users belong to an approved organization while removing the organization-name-first blocker from the client login.
- Approved organization: `Sentinel Development`, identifier `sentinel-development`, organization ID `org_KsbBhzesUXlz9lFo`.
- Verified organization member: `bryan@deeptrack.io`.

## Production Role Claims

- Custom Post-Login Action: `Sentinel Role Claims`.
- Action ID: `6645c45b-2533-466b-8a63-bf66a4789a43`.
- Runtime: Node 22.
- The Action was created, deployed, and attached to the production Post-Login flow. Auth0 displayed **All changes are live** after attachment.
- The Action emits namespaced `https://deeptrack.io/roles` and `https://deeptrack.io/role` claims for approved internal roles.
- The production `administrator` role was created. `compliance_analyst` and `reviewer` remain to be created, and no privileged role assignment was made without explicit user-level approval.

## Remaining Acceptance Work

- Perform a fresh Sentinel login with an approved organization member and verify that no organization-name prompt appears.
- Assign only the minimum required internal role to each approved internal user, then force a fresh login so new tokens contain the role claim.
- Verify `/internal-ops/monitoring` for an approved role and confirm that an authenticated user without an approved role is denied.
- Confirm live dashboard metrics, AML audit events, watchlist freshness, review queue data, and weekly compliance report status.

## 2026-08-22 B2B Login Correction

Fresh-login testing showed Auth0 rejected the approved user because the Business Users application requires an organization parameter on the authorization request. The Sentinel login route now supplies `AUTH0_ORGANIZATION_ID` server-side for the login endpoint, so clients do not type an organization name while Auth0 still enforces organization membership. The application role mapper also maps the production `administrator` claim to the existing internal `admin` contract.

Required production deployment variable: `AUTH0_ORGANIZATION_ID=org_KsbBhzesUXlz9lFo` in the Vercel Production environment. After adding it, redeploy and repeat the fresh login and `/internal-ops/monitoring` acceptance tests. No secret values belong in this document.

Latest controlled backend checks: Convex production deployment succeeded; TypeScript and Next.js build passed; OFAC and UN refreshes completed with 19,249 and 1,011 records respectively; and a controlled weekly compliance report completed with a 64-character SHA-256 export hash.

Current acceptance gap: production Vercel environment update and fresh-token/monitoring verification remain pending because the Vercel project settings session requires a separate authenticated access path. The Auth0 production tenant contains the deployed and attached Sentinel Role Claims Action, the `administrator`, `compliance_analyst`, and `reviewer` roles, and `administrator` is directly assigned to `bryan@deeptrack.io`.


## Latest Verification Update

`AUTH0_ORGANIZATION_ID=org_KsbBhzesUXlz9lFo` was added to the Vercel Production environment and deployment `C7At6NULkJyND6EA9ni38kL7o2Yi` built from commit `3b9ee4f` reached Ready status.

A clean login using the `Username-Password-Authentication` connection no longer shows the organization-name prompt. The login route now passes the organization ID server-side. However, the current authenticated monitoring request still renders the fail-closed unavailable-data state. Auth0 returned the organization-membership error for the previously cached Google identity; the approved database identity must be used for the final test. If the database identity still cannot load monitoring after a fresh login, inspect the server-side Auth0 access token used by `ConvexHttpClient` and verify it is a JWT accepted by the Convex Auth0 provider, without logging token contents.
