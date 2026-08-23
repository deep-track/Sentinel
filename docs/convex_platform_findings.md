# Convex platform findings

Date: 2026-08-21

The authenticated Convex team is **Deeptrack** at `https://dashboard.convex.dev/t/deeptrack`.

An existing Convex project named **platform** is present with slug/project identifier `platform-2f787`.

Deployments shown for this project:

- Production: `insightful-lark-924`
- Development for `dev/deeptrack`: `dashing-gazelle-279` (currently selected)
- Development for `dev/paul-ochieng-okello`: `basic-possum-665`

The selected development deployment reports:

- Cloud URL: `https://dashing-gazelle-279.convex.cloud`
- HTTP Actions URL: `https://dashing-gazelle-279.convex.site`
- Region: US East (N. Virginia)
- Status: Never deployed
- No backup yet

The platform project is likely an existing Deeptrack backend candidate, but it has not been confirmed as the Sentinel deployment. The Sentinel repository currently has no actual Convex URL or deployment value committed. Do not change or reuse this project until its schema and ownership are confirmed.

Production deployment URL was not opened; only the deployment name `insightful-lark-924` was observed from the deployment selector.

## Production deployment confirmation

The platform project's production deployment is `insightful-lark-924`.

- Cloud URL: `https://insightful-lark-924.convex.cloud`
- HTTP Actions URL: `https://insightful-lark-924.convex.site`
- Region: US East (N. Virginia)
- Status: Never deployed
- No backup yet

The existing `platform` project is therefore an empty/un-deployed Convex project in both its development and production deployments. It is not yet running Sentinel functions.

## Auth0 tenant found

The authenticated Auth0 management dashboard is for the development tenant slug `dev-08kwsss3wr77v0k0`.

This confirms the active tenant context, but the exact Auth0 custom/default domain should be read from Auth0 tenant settings before setting Convex `AUTH0_DOMAIN`. The likely default domain is based on this tenant slug, but it must not be guessed.

## Verified Auth0 domain

The Auth0 management dashboard identifies the active development tenant as `dev-08kwsss3wr77v0k0` in region US-5. The URL `https://dev-08kwsss3wr77v0k0.us.auth0.com` resolves to the Auth0 tenant landing page, confirming the non-secret Auth0 domain for Convex configuration:

`dev-08kwsss3wr77v0k0.us.auth0.com`

## Sentinel Auth0 application

The authenticated Auth0 development tenant has an application named `Sentinel` with type `Regular Web Application`.

Its non-secret Client ID is:

`WTWmrqUgoRecLED5EsnV1g7A0DyZrcgK`

A separate `Sentinel Development Management API` application exists, but it is not the client used by the Convex Auth0 provider. Its secret was not accessed.
