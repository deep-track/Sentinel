# Sentinel AML Production Deployment Checklist

**Owner:** DevOps and Compliance Engineering
**Current deployment target:** Vercel with Convex production backend
**Future target:** AWS EC2 with the same application contract
**Status:** Release checklist for controlled production launch

> Do not process real customer or investor data until every mandatory item is checked, the Auth0 role Action is live, and the end-to-end acceptance tests pass in the production configuration.

## 1. Release scope and change control

| Check | Requirement | Evidence / owner |
|---|---|---|
| [ ] | Confirm the intended GitHub commit and deployment branch. The current implementation was pushed to `main` as commit `615b431`. | DevOps |
| [ ] | Confirm the release has an approved change record and named rollback owner. | Engineering lead |
| [ ] | Confirm that development Auth0, Convex, and test-client data are not being used for live customers. | Compliance owner |
| [ ] | Confirm the production hostname, support contact, incident channel, and maintenance window. | Product / DevOps |
| [ ] | Confirm legal/compliance approval for OFAC, UN, AML, review, retention, and escalation policies. | Compliance / Legal |

## 2. Vercel application configuration

The current web application is deployed on Vercel. Configure these values in the **production** environment only; do not commit them to GitHub or place secrets in browser-exposed variables.

| Variable | Required value or rule |
|---|---|
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | Final Sentinel production URL, including HTTPS |
| `NEXT_PUBLIC_APP_URL` | Same final public URL |
| `AUTH0_SECRET` | Secret generated and stored only in Vercel’s encrypted environment store |
| `AUTH0_DOMAIN` | Production Auth0 tenant domain, not the development tenant |
| `AUTH0_CLIENT_ID` | Sentinel production Web Application client ID |
| `AUTH0_CLIENT_SECRET` | Production Auth0 Web Application secret |
| `AUTH0_ROLE_CLAIM` | `https://deeptrack.io/role` |
| `AUTH0_COMPANY_ID_CLAIM` | Approved tenant/company claim namespace |
| `NEXT_PUBLIC_CONVEX_URL` | Approved Convex production cloud URL |
| `CONVEX_DEPLOYMENT` | Approved Convex production deployment name |
| `CONVEX_SITE_URL` | Approved Convex production HTTP Actions URL |
| Provider secrets | Configure only providers enabled for the release; keep all server-side |

After saving the environment variables, trigger a clean Vercel production redeploy from the approved `main` commit. Confirm the build succeeds and verify that no secret appears in build logs, client JavaScript, page source, or browser network responses.

## 3. Auth0 production tenant and token claims

Create or select a **production** Auth0 tenant separate from the development tenant. Configure the production Sentinel Web Application with the exact callback, logout, and allowed-origin URLs for the final Vercel hostname.

Deploy the prepared `auth0/sentinel-role-claims-action.js` as a Post-Login Action. Bind the deployed version to the Post-Login flow. The Action must read only `event.authorization.roles`, filter to the Sentinel allowlist, normalize spaces and hyphens, and emit:

```text
https://deeptrack.io/roles
https://deeptrack.io/role
```

Assign approved roles only through Auth0 administration:

| Role | Intended access |
|---|---|
| `administrator` | Full approved internal operations |
| `compliance_analyst` | AML monitoring and review operations |
| `reviewer` | Review queue operations within assigned authority |
| `compliance_reviewer` | Compliance review operations |

Force a fresh login after role assignment. Verify a newly issued token in a secure local tool. Do not paste tokens into chat, GitHub, tickets, or logs. Confirm that an authenticated user without an approved role receives `forbidden` from protected Convex operations.

## 4. Convex production deployment

Confirm that the Convex production deployment is the intended Deeptrack project and environment. Deploy from the approved repository commit and verify schema validation.

```bash
npx convex deploy
npm run typecheck
npm run build
```

Confirm the following server functions are present:

| Area | Required capability |
|---|---|
| Watchlists | OFAC SDN and UN Consolidated XML ingestion |
| Cron | Daily OFAC/UN imports and weekly compliance report |
| AML | Paginated active-watchlist loading and normalized/fuzzy matching |
| Verification | Protected `/v1/verify/aml` path with API-key and tenant checks |
| Review | Flagged-entity and review-queue persistence |
| Audit | `aml.screened`, `aml.screening_failed`, review, and configuration events |
| Reports | Weekly compliance report storage, export hash, and protected listing |
| RBAC | Auth0 role-claim enforcement for internal operations |

## 5. Watchlist source readiness

Verify that the production source configuration points to approved official sources:

```text
OFAC SDN XML:
https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML

UN Consolidated XML:
https://scsanctions.un.org/resources/xml/en/consolidated.xml
```

Run a controlled import and verify that each source has a non-zero active version, source URL, content hash, record count, last-success timestamp, and no current error. The last validated import produced 19,249 OFAC records and 1,011 UN records, but source counts must be revalidated at release time because official lists change.

Confirm that a failed, empty, malformed, or unexpectedly small source cannot replace the last active version. Confirm that source freshness is visible to operations and that a stale source creates an incident or review condition.

## 6. AML verification and decision policy

Run the protected AML endpoint with a test API key and tenant-scoped client. Confirm that the route rejects missing or revoked keys, unknown clients, insufficient credits, and cross-tenant requests.

Validate the following outcomes:

| Scenario | Expected result |
|---|---|
| Clear synthetic subject | `pass` |
| Exact known watchlist fixture | `reject` or policy-defined escalation with a flagged record |
| Alias or normalized match | `review` or policy-defined escalation |
| Ambiguous fuzzy candidate | `review` and a pending review-queue item |
| Source unavailable or stale | Fail closed; do not return a clean result |
| Unauthorized internal user | `forbidden` |
| Approved analyst/admin role | Authorized monitoring/review access |

A fuzzy score must create an investigation signal, not an irreversible decision by itself. Every possible match must retain the watchlist version ID, entry ID, source, score, matching method, verification ID, tenant, reviewer decision, and timestamps.

## 7. Weekly compliance export and reporting

The Convex cron schedule is:

| Job | Schedule | Purpose |
|---|---|---|
| OFAC ingestion | Daily at 03:15 UTC | Refresh OFAC SDN data |
| UN ingestion | Daily at 03:45 UTC | Refresh UN Consolidated data |
| Weekly compliance report | Monday at 04:30 UTC | Export the preceding seven-day verification, review, and screening-audit activity |

Before production launch, run:

```bash
npm run compliance:report:dry-run
```

The local dry-run must validate the report envelope, required fields, count consistency, and 64-character SHA-256 export hash without contacting Convex or sending a report. The production job must store a completed or failed report record and expose the report status to approved internal operations.

Confirm the weekly report includes verification counts, AML verdict counts, review-queue counts, screening audit counts, failure counts, period start/end, generated timestamp, export data, and export hash. Confirm that report data is tenant-safe and that the export does not include raw secrets or unnecessary identity data.

## 8. Monitoring and alerting

Configure alerts for:

| Alert | Trigger |
|---|---|
| Watchlist stale | Source has exceeded its approved freshness window |
| Watchlist failure | Ingestion action fails or produces an invalid/empty import |
| Screening failure | `aml.screening_failed` events exceed the baseline |
| Review backlog | Pending high-priority reviews exceed the SLA |
| Report failure | Weekly report status is `failed` or missing after the expected window |
| Auth denial spike | Unauthenticated/forbidden requests increase unexpectedly |
| Credit abuse | Abnormal AML request volume or repeated failed-key use |

The internal monitoring page must be limited to approved Auth0 roles. Confirm that the dashboard shows recent report status, export hashes, review counts, AML outcomes, screening events, and failure events.

## 9. Security and privacy controls

Confirm that secrets are stored only in Vercel’s encrypted environment store or the future AWS secret-management system. Confirm that `.env.local`, credentials, API keys, Auth0 secrets, raw tokens, and provider secrets are excluded from Git.

Confirm rate limiting, API-key hashing, key revocation, tenant scoping, CSRF protections where applicable, open-redirect protections, generic authentication errors, and fail-closed behavior. Confirm that audit logs are append-oriented and that operational users cannot silently rewrite compliance evidence.

Review data retention, deletion, access requests, incident response, and export handling with Compliance and Legal. Watchlist data may be globally shared, but screening activity and customer records must remain tenant-scoped.

## 10. Acceptance test and go/no-go gate

The release is **GO** only when all of the following pass:

- [ ] Production Auth0 login and callback flow works.
- [ ] New tokens contain the expected role claim for approved internal users.
- [ ] Users without approved roles are denied internal operations.
- [ ] Vercel production build succeeds from the approved commit.
- [ ] Convex production deployment succeeds with schema validation.
- [ ] OFAC and UN active versions are non-zero and fresh.
- [ ] Clear, exact-match, alias, fuzzy, source-failure, and revoked-key tests pass.
- [ ] Flagged entities and review-queue records retain watchlist lineage.
- [ ] AML audit events are written for success and failure paths.
- [ ] Weekly report dry-run passes locally.
- [ ] Production report generation succeeds once under controlled conditions.
- [ ] Monitoring page is accessible only to approved internal roles.
- [ ] Rollback owner and incident contacts are available.

## 11. Rollback plan

If the release must be rolled back, first stop new customer traffic or disable the affected AML route. Redeploy the previous known-good Vercel commit and Convex function version. Do not delete watchlist versions, review items, flagged entities, or audit logs; preserve evidence and mark the incident in the change record.

If a watchlist import is faulty, disable the affected source job and retain the last active version. Never replace an active source version with an empty or invalid import. If an Auth0 Action is faulty, restore the last known-good Action version and require fresh login for affected users.

## 12. Future AWS EC2 migration

When moving from Vercel to EC2, preserve the application contract and move only the hosting boundary. Configure the same runtime variables through AWS Secrets Manager or an equivalent secret store. Update Auth0 callback, logout, allowed-origin, and application URLs to the AWS hostname. Configure TLS, DNS, reverse proxy, process supervision, log shipping, backups, patching, and health checks.

Convex can remain the backend during the initial EC2 phase. If it is later replaced with PostgreSQL, treat that as a separate migration project with schema mapping, backfill, dual-read or dual-write strategy, audit preservation, and end-to-end AML reconciliation.

## References

[1]: https://auth0.com/docs/customize/actions/explore-triggers/post-login "Auth0 Post-Login Actions"

[2]: https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims "Auth0 Custom Claims"

[3]: https://docs.convex.dev/scheduling/cron-jobs "Convex Cron Jobs"

[4]: https://sanctionslist.ofac.treas.gov/Home/SdnList "OFAC SDN List"

[5]: https://scsanctions.un.org/resources/xml/en/consolidated.xml "UN Security Council Consolidated List XML"
