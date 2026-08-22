# Sentinel Watchlist Ingestion Chamber

## Implementation status

The first ingestion chamber is implemented in Convex and deployed to the Deeptrack `platform` production deployment. It contains daily cron registrations for OFAC SDN and the UN Security Council Consolidated List, source-specific XML normalization, versioned ingestion records, batched entry writes, content hashing, activation of only a fully validated version, and failure tracking.

The implementation is a foundation, not a compliance certification. The source formats must be validated against current official sample files and the ingestion job must be observed in the production environment before Sentinel is marketed as maintaining a complete sanctions database.

## Files

| File | Purpose |
|---|---|
| `convex/schema.ts` | Adds `watchlistSources`, `watchlistVersions`, and `watchlistEntries` |
| `convex/watchlists.ts` | Fetches, parses, normalizes, hashes, versions, and activates source data |
| `convex/crons.ts` | Runs OFAC and UN ingestion daily at staggered UTC times |
| `watchlist_external_sources.md` | Official source references and design notes |

## Required environment variables

The OFAC adapter has a documented HTTPS default URL, but it can be overridden:

```text
WATCHLIST_OFAC_SDN_URL=https://www.treasury.gov/ofac/downloads/sdn.xml
```

The UN source URL must be configured because the Security Council can change its published file location:

```text
WATCHLIST_UN_CONSOLIDATED_URL=https://<approved-un-consolidated-xml-url>
```

The value must be an HTTPS URL. Missing or invalid configuration causes the job to fail and records the failure; it does not activate an empty list.

## Convex cron implementation

`convex/crons.ts` registers two scheduled internal actions:

```ts
crons.cron("ingest OFAC SDN watchlist", "15 3 * * *", internal.watchlists.ingestOfac, {});
crons.cron("ingest UN consolidated watchlist", "45 3 * * *", internal.watchlists.ingestUn, {});
```

The jobs are intentionally staggered. Each action fetches its source over HTTPS, rejects non-success responses and unexpectedly small payloads, parses the source into the shared normalized shape, calculates a SHA-256 content hash, writes entries in batches, and activates the new version only after all records have been written successfully.

## Versioning model

`watchlistSources` stores operational state for each source: source URL, cadence, enabled state, current version, last attempt, last successful import, and last error.

`watchlistVersions` represents an immutable import attempt. Each version stores the source, source version marker, content hash, import status, record count, fetch time, activation time, and failure reason. The statuses are `pending`, `active`, `superseded`, and `failed`. At most one version is promoted to `active` per source by the activation mutation; the previous active version is marked `superseded`.

`watchlistEntries` stores normalized records tied to a specific version. It preserves the source record ID, entity type, primary name, aliases, normalized names, countries, programs, identifiers, and visibility timestamps. This enables a future screening decision to identify exactly which source version was used.

## Fail-closed behavior

The job never converts an empty or malformed download into a clean list. It rejects an HTTP error, a response smaller than the minimum sanity threshold, a source with no expected records, parser failure, or missing source configuration. A failed import leaves the previous active version in place and records the failure on the source and failed version. A production implementation should additionally alert operations when a source has not succeeded within its expected cadence.

## Important production gaps

The current parser is deliberately narrow and should be tested against official OFAC and UN XML fixtures before broad production use. It does not yet implement a durable fuzzy-match index, source-specific schema validation, signed source manifests, retention/archival policy, retry backoff, operational alerting, or a complete `POST /v1/verify/aml` decision path. Those are required before treating the chamber as a finished AML screening product.

The current repository also contains an OpenSanctions live-search adapter. That provider-side lookup is separate from the Sentinel-owned OFAC/UN ingestion path. The integration decision must be explicit: use the local normalized index, use OpenSanctions/Sanctions.io as a provider, or use a defense-in-depth combination with clearly defined precedence and audit semantics.

## Validation and deployment

The implementation was validated with:

```bash
CONVEX_DEPLOYMENT=insightful-lark-924 npx convex codegen
npm run typecheck
npm run build
git diff --check
CONVEX_DEPLOYMENT=insightful-lark-924 npx convex deploy
```

The Convex deployment completed successfully for the Deeptrack `platform` production deployment. The next operational validation is to configure `WATCHLIST_UN_CONSOLIDATED_URL`, run each action against approved fixtures or source data, inspect the version and entry counts, and verify that a failed import leaves the prior active version untouched.

## References

- [OFAC SDN download page](https://sanctionslist.ofac.treas.gov/Home/SdnList)
- [OFAC consolidated list page](https://sanctionslist.ofac.treas.gov/Home/ConsolidatedList)
- [United Nations Security Council Consolidated List](https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list)
- [Sentinel repository](https://github.com/deep-track/Sentinel)
