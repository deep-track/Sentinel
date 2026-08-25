# Sentinel Authentication, Convex Authorization, and Production Debugging Handover

**Prepared for:** Stacy Macharia and the Sentinel engineering team  
**Prepared by:** Manus AI  
**Repository:** [deep-track/Sentinel][1]  
**Production URL:** [https://sentinel.deeptrack.io](https://sentinel.deeptrack.io)  
**Backend:** Convex production deployment `insightful-lark-924`  
**Document status:** Final engineering handover

## 1. Executive summary

Sentinel experienced several consecutive failures during the migration from Clerk to Auth0 and the introduction of customer-level authorization in Convex. The visible symptoms changed as each layer was repaired: Google login initially failed because Auth0 organization membership was enforced but the authorization request did not provide the organization; Auth0 callback and token-bridge routes were inconsistent; Convex reported missing public functions; and authenticated users were redirected to a misleading “Access service unavailable” screen.

The investigation established that these were not one defect. They were failures across four boundaries: **Auth0 authentication**, **Next.js session and token bridging**, **Convex function registration and deployment**, and **application-level tenant authorization**. The final architecture now authenticates users through Auth0, passes an Auth0 ID token to Convex, derives customer membership from the authenticated Auth0 subject, and fails closed when access cannot be verified.

The production system is now stable for the tested administrator path. Bryan Koyundi’s fresh Google/Auth0 login was verified in production and reached the dashboard. Internal administrator access has since been configured for Bryan, Barbara Wangui, and Stacy Macharia through a production Convex allowlist, while ordinary users without an active customer membership remain blocked by design.

> **Important security principle:** successful authentication does not imply authorization. A user may sign in successfully and still receive `/access-pending` when no approved administrator identity or active customer membership is present.

## 2. Final production state

| Area | Final state | Evidence |
|---|---|---|
| Auth provider | Auth0 using Next.js SDK v4 | `backend/lib/auth0.ts`, Auth0 routes |
| Google login | Working after organization-aware login flow and fresh-session testing | Production browser verification |
| Convex authentication | Auth0 ID token passed to Convex | `backend/lib/convex-server.ts` |
| Customer authorization | Fail-closed, derived from Auth0 subject and active membership | `watchlists.currentAccess` |
| Internal administrators | Recognized by Auth0 role claims, configured subjects, or approved production emails | `backend/convex/lib/rbac.ts` |
| Convex production | Deployed to `insightful-lark-924` | Convex deployment output |
| Vercel production | READY and serving `sentinel.deeptrack.io` | Deployment `dpl_CcJ7w9PUa5gxqWECT9AbYr2ymCTr` |
| Data and indexes | Preserved during deployment | Convex reported “No indexes are deleted by this push” |
| Bryan access | Verified directly in the production dashboard | Fresh login reached `/dashboard` |
| Barbara and Stacy access | Production allowlist configured; each must perform a fresh login for individual acceptance testing | Convex environment configuration |

## 3. Debugging timeline

### 3.1 Auth0 organization and Google-login failure

The first production-facing failure occurred during Google authentication. Auth0 returned an error indicating that the Google identity was not part of the Sentinel organization:

```text
user google-oauth2|100021137603088983422 is not part of the org_KsbBhzesUXlz9lFo organization
```

The root cause was an Auth0 organization-aware application configuration combined with an authorization request that did not consistently include the organization identifier. The login route was updated to supply `AUTH0_ORGANIZATION_ID` server-side. This allowed Auth0 to enforce the organization without asking client users to type an organization name.

The relevant production organization identifier was `org_KsbBhzesUXlz9lFo`, and the user-facing organization slug was `sentinel-development`. After the route was corrected, fresh Auth0 login testing was required because existing sessions and tokens did not retroactively acquire the corrected organization or role claims.

### 3.2 Auth0 route and token-bridge corrections

The migration also contained route naming inconsistencies. The application expected the Auth0 token bridge at `/api/auth/token`, while earlier code and testing referred to other paths. The active implementation is now:

```text
app/api/auth/token/route.ts
```

The bridge obtains the Auth0 ID token from the server-side session and makes it available to the Convex client. Convex must receive a token issued for the configured Auth0 application; an arbitrary browser session or stale token is not sufficient.

The Auth0 runtime was hardened so incomplete configuration is treated as an outage rather than an opportunity to grant access. The runtime requires the relevant secret, application URL, tenant domain, client ID, and client secret before creating the Auth0 client. Errors exposed to users are generic, while detailed diagnostics remain server-side.

### 3.3 Convex deployment and function-registration failures

Several deployment attempts failed because the Convex CLI was run from the wrong directory or without a package manifest. Running from `backend/convex` produced:

```text
Unable to read your package.json
```

The working deployment procedure was to run from the repository’s `backend` directory while temporarily providing the root package manifest. The production deployment target is:

```text
CONVEX_DEPLOYMENT=insightful-lark-924
```

An earlier deployment attempt from the repository root also encountered an unresolved `convex/server` component import. The actual backend deployment succeeded after using the correct backend directory and preserving the existing production indexes by answering **No** to destructive index deletion prompts.

A separate runtime problem then appeared:

```text
Could not find public function for 'dashboard:currentAccess'.
```

The investigation showed that newly introduced or differently located Convex modules were not reliably available under the expected production function registry path. The stable solution was to anchor the customer access query in the already registered `watchlists` module and align the frontend with that exact path:

```typescript
anyApi.watchlists.currentAccess
```

This removed the mismatch between the deployed function registry and the frontend query path.

### 3.4 Misleading “Access service unavailable” screen

After the Convex function became available, the platform still displayed:

```text
Access service unavailable
We could not verify your customer access right now.
```

The root cause was a Next.js control-flow issue. `redirect()` in the App Router is implemented by throwing an internal redirect sentinel. The platform layout placed the expected authorization redirect inside a broad `try/catch`, so a normal unauthorized result was caught and remapped to `authorization-unavailable`.

The corrected flow now catches only genuine Convex query failures. The expected authorization result is handled outside the `try/catch`:

```typescript
try {
  access = await convexClient.query(anyApi.watchlists.currentAccess, {});
} catch (error) {
  console.error("[platform-authz] access query failed", error);
  redirect("/access-pending?reason=authorization-unavailable");
}

if (!access.authorized) {
  redirect("/access-pending");
}
```

This distinction is operationally important. A user with no workspace should see the normal access-pending state. A backend outage should produce the service-unavailable reason. These states must not be conflated.

### 3.5 Empty workspace versus backend outage

Once the service-unavailable mapping was fixed, Bryan correctly received:

```text
Your sign-in succeeded, but no active customer workspace is assigned to this account yet.
```

This message was the correct fail-closed behavior for an authenticated identity with no active customer membership. It proved that Auth0 authentication was succeeding and Convex was responding, but the access query had no authorization grant to return.

The requirement then changed from customer membership for Bryan to product-wide internal administrator access. That required a separate authorization path rather than inserting Bryan into an arbitrary customer workspace.

## 4. Final authorization model

Sentinel now has two distinct authorization paths.

### 4.1 Customer users

A regular customer user is authorized only when all of the following are true:

1. Auth0 has authenticated the user.
2. Convex receives the Auth0 identity and its stable `subject`.
3. An active `clientMembers` record exists for that subject.
4. The referenced client exists and has `status: "active"`.
5. The membership role is one of the supported customer roles.

Supported customer roles are:

| Role | Intended scope |
|---|---|
| `client_admin` | Customer workspace administration |
| `compliance_analyst` | Customer compliance and review work |
| `developer` | Customer technical integration work |
| `viewer` | Read-only customer access |

A browser-supplied customer ID is not trusted for authorization. The backend derives the customer scope from the authenticated identity and the `clientMembers` table.

### 4.2 Internal administrators

Internal administrators are recognized through the approved Auth0 role claims emitted by the Sentinel Post-Login Action. Accepted administrator roles include `admin`, `head`, `administrator`, and `internal_admin`. The action emits both namespaced scalar and array claims:

```text
https://deeptrack.io/roles
https://deeptrack.io/role
```

The Convex RBAC helper independently validates these claims. It never trusts a role supplied in request JSON.

Because the live Google identity was initially receiving a token without the expected role claim, the implementation also supports deployment-configured bootstrap controls:

```text
SENTINEL_INTERNAL_ADMIN_SUBJECTS
SENTINEL_INTERNAL_ADMIN_EMAILS
```

The production Convex environment currently contains the approved internal administrator emails:

```text
bryan@deeptrack.io
barbarawangui2002@gmail.com
stacymacharia08@gmail.com
```

The subject allowlist contains Bryan’s confirmed Google Auth0 subject:

```text
google-oauth2|100021137603088983422
```

The Auth0 role claim remains the preferred long-term mechanism. The configured email fallback is intentionally exact-match, server-side, and limited to the approved internal developer identities. It must be reviewed whenever team membership changes.

### 4.3 Product-wide internal access

The production-registered `watchlists.currentAccess` query returns `authorized: true` for an internal administrator even when the administrator has no customer membership. The dashboard `overview` query separately recognizes internal administrators and aggregates data across active clients. Regular users continue to receive only data from their own active memberships.

This design avoids the incorrect solution of assigning an internal developer to a fake customer workspace. It keeps internal operations and customer tenancy conceptually separate.

## 5. Key files and responsibilities

| File | Responsibility |
|---|---|
| `app/(platform)/layout.tsx` | Server-side platform gate; calls `watchlists.currentAccess` and distinguishes backend failure from expected denial |
| `app/access-pending/page.tsx` | User-facing fail-closed state for authenticated users without access |
| `app/api/auth/token/route.ts` | Auth0 token bridge used by the Convex client |
| `backend/lib/auth0.ts` | Auth0 SDK v4 initialization and required-configuration checks |
| `backend/lib/auth.ts` | Maps Auth0 session claims into the application user and internal role contract |
| `backend/lib/convex-server.ts` | Creates the authenticated Convex HTTP client and applies the Auth0 ID token |
| `backend/convex/auth.config.ts` | Auth0 JWT provider configuration for Convex |
| `backend/convex/lib/rbac.ts` | Central role normalization, internal-admin checks, customer-role checks, and configured admin allowlists |
| `backend/convex/watchlists.ts` | Production-registered `currentAccess` authorization query |
| `backend/convex/dashboard.ts` | Tenant-scoped dashboard data and internal-admin aggregation behavior |
| `backend/convex/memberships.ts` | Internal-admin-only customer membership mutations |
| `auth0/sentinel-role-claims-action.js` | Auth0 Post-Login Action that emits approved normalized role claims |
| `docs/README.md` | Deployment, environment, and local administrator setup guidance |

## 6. Deployment procedures that worked

### 6.1 Convex production deployment

The production backend was deployed without deleting existing indexes or data. The working procedure from the repository root was:

```powershell
cd C:\Users\Admin\Sentinel\Sentinel\backend
Copy-Item ..\package.json .\package.json -Force
$env:CONVEX_DEPLOYMENT="insightful-lark-924"
npx convex deploy
Remove-Item .\package.json
```

The equivalent Unix-style procedure used during this handover was:

```bash
cd /home/ubuntu/Sentinel
cp package.json backend/package.json
cd backend
CONVEX_DEPLOYMENT=insightful-lark-924 npx convex deploy
rm -f package.json
```

The successful deployment output included:

```text
No indexes are deleted by this push
Schema validation complete.
Deployed Convex functions to https://insightful-lark-924.convex.cloud
```

To configure the internal administrator emails on the production deployment:

```bash
cd backend
npx convex env set --deployment insightful-lark-924 \\
  SENTINEL_INTERNAL_ADMIN_EMAILS \\
  'bryan@deeptrack.io,barbarawangui2002@gmail.com,stacymacharia08@gmail.com'
```

### 6.2 Vercel deployment

Sentinel is connected to the GitHub `main` branch. Pushing to `main` created the production deployment automatically. The administrator-email change was deployed in:

```text
dpl_CcJ7w9PUa5gxqWECT9AbYr2ymCTr
```

The deployment resolved to:

```text
https://sentinel.deeptrack.io
```

The deployment state was verified as `READY`.

### 6.3 Local development configuration

Local development must have the same administrator environment variable if the local Convex deployment does not already receive the approved Auth0 role claim. Add this to the developer’s uncommitted local environment file:

```env
SENTINEL_INTERNAL_ADMIN_EMAILS=bryan@deeptrack.io,barbarawangui2002@gmail.com,stacymacharia08@gmail.com
```

Do not commit `.env.local`, Auth0 secrets, Convex deploy keys, or token contents. The local variable should be configured in the actual Convex deployment used by the local application, not merely in a shell that is unrelated to that deployment.

## 7. Verification performed

The following checks were completed during the debugging work:

| Check | Result |
|---|---|
| Auth0 organization-aware login route | Corrected |
| Auth0 Google login | Fresh production login succeeded |
| Auth0 ID-token bridge | Corrected and aligned to `/api/auth/token` |
| Convex provider configuration | Auth0 domain and client ID configured |
| Convex function deployment | Successful |
| Index deletion during deployment | Explicitly declined; existing data preserved |
| `watchlists.currentAccess` registration | Confirmed as the stable production path |
| Next.js redirect handling | Corrected so expected redirects are not caught as service errors |
| Customer access gate | Fail-closed behavior confirmed |
| Bryan administrator access | Fresh login reached `/dashboard` |
| Admin dashboard data path | Product-wide internal-admin path deployed |
| Production Vercel build | READY |
| TypeScript validation | Passed after final RBAC changes |
| Local administrator documentation | Added to `docs/README.md` |

The final browser verification showed the following production dashboard state for Bryan:

```text
URL: https://sentinel.deeptrack.io/dashboard
Signed in as: Bryan Koyundi
Visible navigation: Overview, Identity (KYC), Business (KYB), KYI,
AML Screening, Liveness, API Keys, Webhooks, Billing & Credits, Settings
```

Barbara and Stacy were configured in production but were not individually logged into the live browser during the final acceptance sequence. Each should sign out, sign in with the correct Google identity, and confirm that `/dashboard` loads.

## 8. Troubleshooting guide

### “An error occurred during the authorization flow”

Check whether Auth0 reports that the user is not part of the configured organization. If so, verify the organization ID in the Sentinel login route and the user’s organization membership in the correct Auth0 tenant. Do not fix this by removing organization enforcement from the application.

### “State parameter is invalid”

This normally indicates a stale, expired, or mismatched Auth0 transaction. Start a fresh login from `/auth/login`, clear the stale flow by returning to the application, and avoid reusing an old callback URL. Do not copy a callback state value between browser sessions.

### “Could not find public function for `dashboard:currentAccess`”

Verify that the frontend calls `anyApi.watchlists.currentAccess`, not an unregistered `dashboard.currentAccess` path. Then deploy from the correct Convex backend directory and confirm the deployment target is `insightful-lark-924`.

### “Access service unavailable”

Inspect the server logs for `[platform-authz] access query failed`. If the query is successful but the UI still shows this reason, verify that the expected `redirect("/access-pending")` is outside the `try/catch` in `app/(platform)/layout.tsx`.

### “No active customer workspace is assigned”

This is a normal authorization denial, not necessarily a service failure. For a customer user, create or reactivate the correct `clientMembers` record. For an internal developer, verify the Auth0 administrator claim or configure the approved internal subject/email variable in the Convex deployment.

### Administrator still sees access-pending after a role change

Force a complete sign-out and fresh Google/Auth0 login. Auth0 does not retrofit newly assigned claims into an already issued token or existing application session.

### Convex deployment asks to delete indexes

Answer **No** unless a deliberate, reviewed migration explicitly requires index deletion. The Sentinel production deployment contains existing watchlist and verification data that must not be removed as part of an authorization release.

## 9. Remaining operational work

The core authentication and authorization defect is resolved, but the following operational controls should still be completed before broad customer rollout:

1. Assign Barbara and Stacy the Auth0 `administrator` role in the correct Sentinel Auth0 tenant, not in another development tenant. Their exact role claims should become the preferred authorization path over the email fallback.
2. Perform a fresh-login acceptance test for Barbara and Stacy in production and record the result.
3. Configure the same administrator policy in the actual local Convex deployment used by the development team.
4. Add automated tests covering: unauthenticated access, customer membership access, inactive membership denial, internal administrator access, missing Convex response, and redirect-control-flow handling.
5. Add an auditable change record whenever the internal administrator list changes.
6. Remove a person from both Auth0 administrator roles and the Convex configured allowlist when their development responsibility ends.
7. Confirm that internal administrator dashboard aggregation is appropriate for the production data-governance policy. Product-wide visibility is intentionally powerful and should be limited to approved staff.
8. Keep production secrets in the deployment secret manager. Never commit Auth0 secrets, Convex deploy keys, or raw tokens.

## 10. Change history

| Commit | Change |
|---|---|
| `9229e13` | Use Auth0 ID token for Convex authentication |
| `fc2e6e5` | Expose the Auth0 token bridge route |
| `d1f6dc8` | Use Auth0 v4 token response |
| `247e49a` | Request Convex audience in Auth0 session |
| `3d17e17` | Enforce customer authorization and roles |
| `bdde0e4` | Rebuild the Convex Auth0 authentication baseline |
| `9f077e7` | Normalize legacy customer roles safely |
| `56706cd` | Use the stable Convex authentication function path |
| `88e02d0` | Anchor customer authorization in the dashboard module |
| `2dffa24` | Use the registered `watchlists` authorization path |
| `2cecf1e` | Preserve expected Next.js authorization redirects |
| `3e550b9` | Allow internal administrators through the customer access gate |
| `de00bd3` | Support configured internal administrator subjects |
| `2ebdf43` | Support configured internal administrator emails |
| `3d30b70` | Document internal administrator environment setup |

## References

[1]: https://github.com/deep-track/Sentinel "Sentinel repository"

[2]: https://github.com/deep-track/Sentinel/blob/main/app/(platform)/layout.tsx "Sentinel platform authorization layout"

[3]: https://github.com/deep-track/Sentinel/blob/main/backend/convex/watchlists.ts "Production-registered customer access query"

[4]: https://github.com/deep-track/Sentinel/blob/main/backend/convex/dashboard.ts "Tenant-scoped and internal-admin dashboard query"

[5]: https://github.com/deep-track/Sentinel/blob/main/backend/convex/lib/rbac.ts "Sentinel Convex RBAC helper"

[6]: https://github.com/deep-track/Sentinel/blob/main/backend/lib/auth.ts "Sentinel Auth0 application-user mapping"

[7]: https://github.com/deep-track/Sentinel/blob/main/auth0/sentinel-role-claims-action.js "Sentinel Auth0 role-claims action"

[8]: https://github.com/deep-track/Sentinel/blob/main/docs/README.md "Sentinel deployment and environment documentation"

[9]: https://dashboard.convex.dev/t/deeptrack/platform-2f787/insightful-lark-924 "Sentinel Convex production deployment"

[10]: https://sentinel.deeptrack.io "Sentinel production application"

[11]: https://vercel.com/deeptracks-projects-32338107/sentinel/CcJ7w9PUa5gxqWECT9AbYr2ymCTr "Sentinel Vercel production deployment"

[12]: https://auth0.com/docs/secure/tokens/json-web-tokens "Auth0 JSON Web Token documentation"

[13]: https://docs.convex.dev/auth "Convex authentication documentation"

[14]: https://nextjs.org/docs/app/api-reference/functions/redirect "Next.js redirect function documentation"

[15]: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "GitHub authentication and repository security guidance"

## Appendix: handover checklist

| Task | Owner | Status |
|---|---|---|
| Verify Bryan production dashboard access | Bryan / Engineering | Complete |
| Fresh-login test for Barbara | Barbara / Engineering | Pending |
| Fresh-login test for Stacy | Stacy / Engineering | Pending |
| Assign Auth0 administrator role in the correct Sentinel tenant | Auth0 administrator | Pending confirmation |
| Configure local Convex admin environment | Engineering | Pending per local deployment |
| Add automated authz regression tests | Engineering | Recommended |
| Record administrator changes in an audit log | Engineering | Recommended |
| Validate customer isolation with a non-admin test account | Engineering | Recommended |
| Validate product-wide admin visibility with approved staff | Engineering | Partially verified through Bryan |

> **Handover conclusion:** the original login and Convex authorization incident was resolved by treating authentication, token transport, function registration, redirect control flow, and tenant authorization as one end-to-end system. The production system now distinguishes correctly between authentication failure, backend availability failure, customer authorization denial, and approved internal administrator access.
