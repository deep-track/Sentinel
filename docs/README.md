# Sentinel

Sentinel is Deeptrack’s identity, KYC, KYB, AML, liveness, watchlist, and evidence-review platform. The application is a Next.js App Router frontend and server runtime with Convex functions for application data and Auth0 for user authentication and organization identity.

## Production safety

Sentinel must fail closed. A deployment without valid Auth0 configuration must not grant access to platform pages. The platform requires a configured Auth0 tenant, verified role/company claims, and a configured Convex deployment before it should receive real customer or identity data.

The public marketing and sign-in routes can render without an active session. Platform routes require a valid Auth0 session. Administrative invitation actions require an authenticated `admin` or `head` role and a configured Auth0 Organizations Management API integration.

## Local development

Install dependencies and run the development server:

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and provide development-only values. Never commit `.env.local`, Auth0 secrets, management credentials, UploadThing tokens, provider credentials, or API keys.

## Validation and production build

The required local checks are:

```bash
npm ci
npm run typecheck
npm run build
```

The deployment script at `scripts/build.sh` runs the same dependency installation, type check, and Next.js production build. It no longer invokes Prisma because this repository contains Convex functions rather than a Prisma schema.

Convex functions are deployed separately through the approved Convex workflow:

```bash
npx convex deploy
```

The Convex deployment and the Next.js runtime must use the same approved environment and Auth0 issuer configuration. Do not run a database schema push from the web-host build step.

## Runtime configuration

Use `.env.example` as the non-secret key inventory. Real values must be supplied through the host’s secret manager or protected environment configuration.

| Group | Variables |
|---|---|
| Application URL | `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL` |
| Auth0 runtime | `AUTH0_SECRET`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` |
| Auth0 claims | `AUTH0_ROLE_CLAIM`, `AUTH0_COMPANY_ID_CLAIM` |
| Internal administrator bootstrap | `SENTINEL_INTERNAL_ADMIN_SUBJECTS`, `SENTINEL_INTERNAL_ADMIN_EMAILS` |
| Auth0 invitations | `AUTH0_MANAGEMENT_CLIENT_ID`, `AUTH0_MANAGEMENT_CLIENT_SECRET`, `AUTH0_ORGANIZATION_ID`, `AUTH0_INVITATION_CLIENT_ID`, `AUTH0_INVITATION_CONNECTION_ID` |
| Convex | `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `CONVEX_SITE_URL` |
| Server integrations | `DEEPTRACK_BACKEND_URL`, `OPENSANCTIONS_API_KEY` |
| Optional providers | `SHUFTI_CLIENT_ID`, `SHUFTI_SECRET_KEY`, `UPLOADTHING_TOKEN`, `RESEND_API_KEY` |

`AUTH0_MANAGEMENT_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_CLIENT_SECRET`, `UPLOADTHING_TOKEN`, `SHUFTI_SECRET_KEY`, `OPENSANCTIONS_API_KEY`, and `RESEND_API_KEY` are server-only secrets. They must never use a `NEXT_PUBLIC_` prefix or be read by browser components.

## Authentication and authorization

Auth0 is the authoritative login provider for the Next.js application. The application maps the configured role claim to `user`, `admin`, or `head`, and maps the configured company claim to the tenant boundary used by Convex authorization helpers. All data reads and writes must enforce identity and company scope in server-side or Convex functions; hiding a button in React is not an authorization control.

The Auth0 Organizations Management API is required for invitation creation and revocation. Configure the required management API scopes and organization/client/connection IDs before enabling administrator invitation actions. Invitation management is intentionally unavailable when this integration is incomplete.

For local development, set `SENTINEL_INTERNAL_ADMIN_EMAILS` in the local environment to the approved internal developer emails, separated by commas. The production Convex deployment currently contains the approved internal administrator emails `bryan@deeptrack.io`, `barbarawangui2002@gmail.com`, and `stacymacharia08@gmail.com`. Auth0 role claims and exact subject allowlists remain preferred for long-term identity administration; email fallback should be limited to verified Auth0 identities and reviewed whenever team access changes.

## Deployment

The repository can run as a standalone Next.js server because `next.config.ts` uses `output: "standalone"`. The approved host must run `npm run build` and `npm run start` under a process manager or an equivalent managed runtime. Nginx, TLS, DNS, and process-manager configuration belong to the deployment environment and must not be improvised from the development machine.

Before production cutover:

1. Deploy Convex functions to the approved production deployment.
2. Configure Auth0 production callback, logout, allowed-origin, organization, role-claim, and company-claim settings.
3. Configure all required server secrets in the host secret manager.
4. Run `npm run typecheck` and `npm run build`.
5. Test public routes, sign-in, logout, platform access, company isolation, invitation creation/revocation, Convex reads/writes, uploads, webhooks, and error responses.
6. Confirm logs do not contain secrets, tokens, identity documents, or raw provider exceptions.
7. Record the approved commit and deployment identifier before cutover.

## Rollback

Record the previous known-good commit and deployment identifier before each release. Roll back by redeploying the previous approved artifact or commit. Do not delete the service or database to recover from a failed release. Review Convex schema/function changes separately before rolling back application code.

## Security issue reporting

Do not open public issues containing credentials, identity documents, customer data, or exploitable details. Report security concerns through the approved Deeptrack security channel and rotate any credential that has appeared in logs, commits, screenshots, or chat.
