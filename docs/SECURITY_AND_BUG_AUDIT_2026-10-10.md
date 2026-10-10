# Sentinel — Full-Stack Audit (2026-10-10)

Read-only scan of the frontend (Next.js 15 / React 19), the Next server/auth layer (Auth0 v4, server actions, API routes) and the Convex backend (`backend/convex`). Findings were confirmed by reading the code; the top items in each area were re-checked by hand. Duplicates found by more than one pass are merged.

**Tooling results**
- `tsc --noEmit` (app and `backend/convex`): passes, but much of the code path is untyped (`anyApi`, `internalApi: any`), so it catches little.
- `next lint`: 12 errors (`no-explicit-any`) and 9 warnings (unused vars). Lint is skipped during builds (`next.config.ts` `ignoreDuringBuilds: true`).
- `npm audit --omit=dev`: **1 critical, 3 high**:
  - `next` 15.5.23: RCE in Image Optimization (AVIF), cache poisoning. Fixed in 15.5.27.
  - `axios` 1.0.0–1.19.0: SSRF and prototype pollution.
  - `sharp`.
  - `source-map-js`.
- `node --test tests/*.integration.js`: 6 pass, 1 fail (`kyc-review.integration.js:20` expects a component that was removed). The tests only regex-match source text.
- No secrets are committed. `SENTINEL_VERCEL_ENV.example` does contain the real Auth0 tenant/org ID, the Convex deployment name and admins' personal emails.

---

## 🔴 Critical

| # | Area | Location | Issue |
|---|------|----------|-------|
| C1 | Backend | `backend/convex/apiKeys.ts:71-92` | `generateApiKey` is a **public `action` with no auth**. Anyone who knows the Convex URL can mint a **live API key for any `clientId`**, which gives read access to that tenant's verifications through `/v1/verify/*` and lets them submit billed checks. **Fix:** delete it (`createForClient` is the authenticated version) or make it `internalAction`. |
| C2 | Deps | `package.json` | `next@15.5.23` has a critical advisory (Image Optimizer RCE, cache poisoning). Upgrade to ≥15.5.27. Also upgrade `axios` (redirect SSRF, prototype pollution). |
| C3 | Frontend | `modules/kyc/steps/selfie-capture-step.tsx:106-113` | **Liveness bypass:** the uploaded still selfie is sent as `livenessFramesBase64`, so a photo of anyone passes the "Liveness Check" and the report shows it as passed. |
| C4 | Frontend | `modules/kyi/kyi-wizard.tsx:105` vs `backend/convex/kyi.ts:29` | **Every KYI submission fails.** `investmentAmount` is a string (`z.string()`), but the validator expects `v.number()`. |

## 🟠 High

| # | Area | Location | Issue |
|---|------|----------|-------|
| H1 | Next auth | `backend/lib/auth0.ts:66-75`, `backend/lib/auth.ts` | There is no `beforeSessionSaved`, so Auth0 SDK v4 strips the custom `https://deeptrack.io/role(s)` and `companyId` claims from the session. `getRole()` always returns `"user"`. Internal-ops always redirects to `/dashboard`, invitations always fail, and `/new-org` always bounces. Role-based access in the Next layer does not work. |
| H2 | Next / Frontend | `app/api/uploadthing/core.ts:10-12` | The **UploadThing endpoint is unauthenticated** (`.middleware(async () => ({}))`). Anyone can upload 16 MB files to the bucket. KYC ID images go to public CDN URLs before consent, with no user or tenant recorded. |
| H3 | Backend | `clients.ts:7-20`, `lib/webhookDispatch.ts:74-82`, `webhooks.ts` | **Webhook SSRF and data exfiltration.** Any URL is accepted (http, localhost, 169.254.169.254) and redirects are followed. The response status is stored and `resendWebhook` re-triggers on demand, which works as a blind internal scanner. The lowest write role (`developer`) can redirect all PII-bearing results and rotate the secret without an audit entry. |
| H4 | Backend | `lib/riskEngine.ts:119-153`, `lib/awsClients/amlClient.ts:24-28` | **The risk engine fails open:** <ul><li>An unknown IPRS status falls through the `switch` with no `default`.</li><li>`ADVERSE_MEDIA` and unknown AML statuses map to `"clear"`.</li><li>A match score of 86–100 with a CLEAR status passes.</li></ul> All three can end in `verdict: "pass"`. |
| H5 | Backend | `amlPersistence.ts:4-14`, `aml.ts` | AML screening runs even if only one sanctions list (e.g. UN only, no OFAC) is active, and there is no staleness check. The result still says "No OFAC or UN watchlist match". |
| H6 | Backend | `lib/rbac.ts:139-144` | Internal-admin status is granted from the `email` claim without checking `email_verified`. With an unverified signup that grants full cross-tenant admin. |
| H7 | Backend | `verifications.ts:197-207` | `verifications.review` lets any internal reviewer overwrite any verdict (e.g. sanctioned → pass) in any state. It writes no audit log, skips the certainty and notes rules, and leaves the `reviewQueue` row pending. |
| H8 | Backend | `http.ts:88-105`, `creditLedger.ts`, all create paths | **Credits are broken end to end:** <ul><li>No `"allocation"` ledger row is ever written, so every balance is ≤ 0 and `POST /v1/verify/idp` always returns 402.</li><li>Dashboard creation paths never check the balance.</li><li>The balance check is not atomic with the deduction, so it can be double-spent.</li><li>`creditLimit` is never read.</li><li>AML is charged twice when it goes through review (`aml.ts:168` and `reviewQueue.ts:156`).</li><li>KYI is never charged.</li></ul> |
| H9 | Frontend | `app/(platform)/aml-check/aml-screening-form.tsx:9,25` | The AML Check page crashes (`rows.map is not a function`) because `verifications.list` returns `{records, nextCursor}`. |
| H10 | Frontend | `app/(platform)/dashboard/page.tsx:9-16`, `credit-usage-card.tsx:5` | The dashboard always shows zeros. It server-fetches its own API routes without cookies, gets a 503, and renders that as data. `/api/client/billing` does not exist, and the page returns a 500 if `NEXT_PUBLIC_APP_URL` is unset. |
| H11 | Frontend | `modules/kyb/steps/review-step.tsx:25` | **KYB can never be submitted.** `submitKYB` is a stub that always throws, and `/kyb/new` never resolves a `clientId`. |
| H12 | Frontend | `modules/kyi/steps/kyi-document-step.tsx`, `financial-docs-step.tsx` | KYI stores `blob:` URLs (which only work in the submitter's tab) and full base64 `data:` URLs in the database. PDFs over ~1 MB exceed Convex's document limit, and object URLs are never revoked. |
| H13 | Next | `app/internal-ops/layout.tsx:19-25` | The internal-ops gate **fails open** when `APP_BASE_URL` is unset (a "dev bypass" in production). Its notion of "configured" also differs from `getAuth0()`. |

## 🟡 Medium

**Backend**
- `verifications.ts:54-85`: `create` persists raw `input` (`v.any()`), including base64 ID images and liveness media.
  - Real images exceed 1 MiB, and smaller ones are readable by every member, viewers included.
  - The `kyb` branch creates no directors, so processing always fails.
- `http.ts:81-119`: the only validation is a truthiness check. Bad types pass, the scheduler validator then throws, and the client gets a 500 with an orphaned `queued` row. Multi-MB base64 is passed as scheduler arguments.
- Unbounded `.collect()` calls will hit Convex read limits as data grows:
  - `monitoring.ts:13,27` (whole `reviewQueue` and `auditLog`)
  - `verifications.ts:17-37`
  - `dashboard.ts:43,60-68`
  - `reviewQueue.ts:30-35`
  - `auditLog.ts:39-42`
  - `creditLedger._getBalance`, which runs on every API call
- `monitoring.ts:28-41`: counts are computed after `.slice(0, limit)`, so they are wrong.
- `complianceReports.ts`: the 5000-row cap silently truncates (AML audits filtered after paging), and the export stored in a single document will exceed 1 MiB. The report is still marked "completed".
- `liveness.ts`:
  - Twilio `failed`/`undelivered` callbacks are dropped once the row is `sent`.
  - A delivery failure never fails the linked verification, which stays `queued` forever.
  - There is no try/catch or timeout on the Twilio fetch.
  - No review-queue row is created for "review" verdicts.
  - Liveness and AML completions never send the client webhook (KYI and KYB-review also don't).
- `liveness.ts:10-24`: the contact number is not validated, there is no rate limit, and it costs 0 credits. This is **SMS toll-fraud** exposure on Sentinel's Twilio account.
- `watchlists.ts:129-131`: UN alias names get the `QUALITY` value appended ("JOHN DOE Good"), so exact alias matches never hit. `ENTITY_ALIAS` is never parsed.
- `watchlists.ts`: superseded versions are never garbage-collected (~20k rows per day), and every screening scans the whole active list.
- `internalFetch.ts:28-30`, `riskEngine.ts`: raw upstream error bodies go into `verification.result` and are sent to clients in webhooks.
- `apiKeys.ts:154-199`: **test keys behave like live keys** (real providers, billed).
- `lib/rbac.ts`:
  - `view_only` is only enforced in `requireClientRole`, not in `requireInternalAdmin`/`requireInternalUser`.
  - `requireClientRole` never checks whether the client is suspended or expired.
- Role lists disagree across the Auth0 Action, `rbac.ts` and `backend/lib/auth.ts`:
  - `compliance_analyst`/`compliance_reviewer` are emitted by the Action but rejected by the backend.
  - `.env.example` uses `/role` while Vercel uses `/roles`.
  - The singular `/role` claim is `roles[0]`, which is order-dependent.
- Deploy footgun: there is no `convex.json`, and the root `convex/` folder is empty. `npx convex deploy` from the repo root would deploy **zero functions** (this matches `convex-auth-findings.md`).

**Next server / auth**
- `backend/actions/auth-actions.ts`: the public server actions `addNewUser` (role supplied by the client) and `findUser` have no auth. They are inert today only because `/api/users` is missing.
- `backend/lib/actions.ts`: the legacy actions (`createApiKey`, `getApiKeys`, `verifyIdentityServerSide`) have no auth or tenant scope and call routes that don't exist.
- `backend/actions/invitations.ts`: `createInvitation` trusts the client-supplied `companyId`, and `revokeInvitation` can revoke any company's invite. This becomes exploitable once H1 is fixed.
- `middleware.ts:44-55`: `?organization=` on login is not overwritten, and `org_id` is never checked.
- `middleware.ts:37-75`: the middleware isn't `async`, so the try/catch never catches session decrypt errors. Stale cookies cause a 500 on every page.
- `app/auth/[auth0]/route.ts:61`: calls `auth0.handleAuth()`, which was removed in v4, so it returns a 500.
- `app/auth/token/routes.ts`: misnamed, so it is dead code.
- `app/api/auth/[auth0]/route.ts`: a GET-triggered Auth0 logout that keeps the local session.

**Frontend**
- `document-capture-step.tsx:39`: the `data:` prefix is kept on document base64 but stripped on the selfie, so the document scan gets malformed input. When the ID type is switched to Passport, the back-side data is still submitted.
- There is **no `error.tsx`**, and client `useQuery` calls don't wait for `useConvexAuth`. Any `ConvexError` shows the raw Next error page.
- "Failed" status is displayed as "Pending" (`kyc/[id]/page.tsx:294-301`, `kyi/page.tsx:59`).
- The Members page always looks empty for customers, because `memberships.listForClient` requires an internal admin.
- The webhook dialog loses the one-time secret on Esc or an outside click, after the old secret has already rotated.
- `memberships[0]` scoping in 7 pages: multi-org users and internal admins act on whichever organization happens to be first.
- `kyc/[id]/result/page.tsx:36-39`: shows "verification complete" based only on a query parameter.
- `kyb-wizard.tsx:205-212`: `setTimeout` runs during render and is never cleared.
- Links that 404:
  - `/kyb/[id]`
  - `/internal-ops` (index) and most internal-ops nav items
  - The landing page CTA for `head` users goes to the `/new-org` stub.
- KYC date of birth and ID number have no format validation, and `prefillEmail` is ignored.

## 🟢 Low

**Security hardening**
- `next.config.ts`: no security headers (CSP/frame-ancestors, HSTS, Referrer-Policy, `Permissions-Policy: camera=(self)`).
- Webhook signing secrets are stored in plaintext, and the signature has no timestamp header (no replay protection).
- `lib/twilio.ts:2`: uses `localeCompare` for signature canonicalisation, which can reject valid callbacks.
- `crypto.ts`: the API-key prefix has only 32 bits of randomness, and `.unique()` throws on a collision.
- `backend/convex/auth.ts`: the unused Convex Auth (GitHub) exposes public `signIn`/`signOut`.
- The rate limit runs only after authentication. Different "revoked"/"invalid" error messages reveal whether a key prefix exists. `rpmCap` is unused.
- `backend/lib/opensanctions.ts`: logs the full query URLs, which include screened names (PII).
- `SENTINEL_VERCEL_ENV.example`: real tenant, org and deployment IDs and personal admin emails. The admin env vars are also read only by Convex, so setting them in Vercel has no effect.

**Correctness and behaviour**
- `apiKeys.ts:196`: `_touchLastUsed` is not awaited in an httpAction.
- `webhooks.resendWebhook`: resending while retrying starts duplicate retry chains.
- `idp.ts`: an error after completion overwrites a completed verdict with `failed` and sends a FAILED webhook.
- `aml.ts:105-115`: `decide()` only inspects `matches[0]`, and `entityType`/`country` are ignored.
- `liveness.ts`: the placeholder `providerMessageId: "unknown"` causes `.unique()` collisions.
- No fetch timeouts in watchlist ingestion. A shrunken or partial list is still activated.
- `reviewQueue.resolve`:
  - Escalate sets `resolvedBy` on an item that is still unresolved.
  - The ledger reason and feedback label are hard-coded for IDP.
- The thin audit trail misses membership, API-key, webhook and verdict-override changes.
- Frontend:
  - The API-key form has buttons without `type="button"`, so clicking copy or show creates extra live keys. The key name is discarded.
  - The liveness "email" option always fails, and there is no loading state.
  - The KYB country and KYI email columns read fields that are never stored.
  - date-fns formatting causes hydration mismatches.
  - The KYI Back button loses uploads.
  - "Confidence" is hard-coded to 0 or 100%.

**Code hygiene and build**
- The stale `backend/convex/_generated/api.d.ts` is missing `kyb`, `kyi`, `kyc`, `settings`, `feedbackLabels` and `flaggedEntities`. This forces `any` casts and `anyApi` throughout, so type errors (C4, H9) go uncaught. Run `npx convex codegen`.
- Empty modules: `kyc.ts`, `feedbackLabels.ts`, `flaggedEntities.ts`.
- `dashboard.currentAccess` and `watchlists.currentAccess` diverge. The findings docs reference `authz.ts` and `auth.currentAccess`, but neither exists.
- Dead or broken code:
  - `kyc-review-client.tsx`, `kyc-review-actions.tsx`, `kyi-review-client.tsx`
  - `apiKey-generator.tsx`
  - `metrics-grid.tsx` and `conversion-chart.tsx` (dummy data)
  - `backend/lib/clerk-client.ts`
  - `components/file-upload.tsx` imports the server router into the client.
- `output: "standalone"` conflicts with `next start` in `render.yaml`.
- `PUBLIC_ROUTES` matches by prefix, and its `/kyc/new` "invitation flow" entry is wrong.

---

## Suggested fix order
1. **Today:**
   - C1 (delete `generateApiKey`)
   - C2 (bump `next`/`axios`)
   - H2 (auth on UploadThing)
   - H3 (webhook URL validation, `redirect: "manual"`)
   - H6 (`email_verified`)
   - H13 (internal-ops fails closed)
2. **Compliance correctness:**
   - H4 (risk engine `default → review`, adverse media)
   - H5 (require every list, freshness check)
   - H7 (remove or route `verifications.review`)
   - C3 (real liveness)
3. **Auth plumbing:**
   - H1 (`beforeSessionSaved` claims)
   - Unify the role list across the Action, `rbac.ts` and `auth.ts`
   - Invitation company scoping
   - Remove the legacy server actions and the dead auth routes
4. **Product-breaking bugs:** C4, H8 (credits), H9, H10, H11, H12.
5. **Platform health:**
   - Regenerate Convex types and remove `anyApi`/`any`
   - Index and paginate the `.collect()` calls
   - Add `convex.json`
   - Add `error.tsx`
   - Add security headers
   - Re-enable lint in builds
