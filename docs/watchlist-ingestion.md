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
WATCHLIST_UN_CONSOLIDATED_URL=https://scsanctions.un.org/resources/xml/en/consolidated.xml
```

This is the official UN feed and is set on the production deployment (`robust-parakeet-542`) as of 12 October 2026. It answers with a redirect to a short-lived signed download URL, which `fetch` follows; the UN parser was checked against it (1,010 records). It was unset until then, so UN ingestion never ran in production.

The value must be an HTTPS URL. Missing or invalid configuration causes the job to fail without activating anything: the error is written to the source's `lastError`, and the Sentinel Ops overview shows it in the "watchlist unavailable" alert.

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

The current parser is deliberately narrow and should be tested against official OFAC and UN XML fixtures before broad production use. It does not yet implement a durable fuzzy-match index, source-specific schema validation, signed source manifests, retention/archival policy, retry backoff, or operational alerting. Those are required before treating the chamber as a finished AML screening product.

## OpenSanctions (defense in depth)

AML screening (`aml.runScreening`) checks every subject against both the Sentinel-owned OFAC/UN index and the OpenSanctions `/match/default` API (`backend/convex/lib/openSanctions.ts`), in parallel. Precedence and audit semantics:

- The stricter verdict wins (`reject` > `review` > `pass`).
- OpenSanctions results count only when the API flags them as a match (score ≥ 0.7). A sanctions-topic match (`sanction`, `sanction.linked`, `crime.terror`) scoring ≥ 0.9 is a `reject`; a weaker sanctions match, a PEP match (`role.pep`, `role.rca`, `role.oligarch`) or any other risk-list match is `review`.
- If OpenSanctions is unreachable, returns an error, or `OPENSANCTIONS_API_KEY` is not set in the **Convex** environment, it is a coverage gap: the screening cannot pass, is held for review, and is not billed — exactly like a stale or missing local list.
- OpenSanctions matches are stored on the verification result and in `flaggedEntities` with `source: "OPENSANCTIONS"`, the OpenSanctions entity id (`externalId`), topics and datasets. The audit row records the OpenSanctions status and entity ids.

`POST /v1/verify/aml` (body: `subjectName`, `entityType` = `individual` | `entity`, optional `country`) starts a screening over the public API; `GET /v1/verify/{id}` returns a `screening` object (reason, sources screened, matches) for completed AML checks. Test-mode API keys get a sandbox `pass` with no screening and no charge.

## Validation and deployment

Production is the Convex deployment `robust-parakeet-542`. Vercel does not deploy Convex functions, so after a merge to `main`:

```bash
CONVEX_DEPLOYMENT=prod:robust-parakeet-542 npx convex deploy --dry-run
CONVEX_DEPLOYMENT=prod:robust-parakeet-542 npx convex deploy
```

To load a list immediately instead of waiting for its nightly run (on Windows PowerShell, set `$env:CONVEX_DEPLOYMENT` first and use `npx.cmd`):

```bash
CONVEX_DEPLOYMENT=prod:robust-parakeet-542 npx convex run watchlists:ingestUn
```

As of 12 October 2026 production holds OFAC SDN (19,416 records, refreshed daily) and UN Consolidated (1,010 records). Remaining validation: confirm that a failed import leaves the prior active version untouched.

## References

- [OFAC SDN download page](https://sanctionslist.ofac.treas.gov/Home/SdnList)
- [OFAC consolidated list page](https://sanctionslist.ofac.treas.gov/Home/ConsolidatedList)
- [United Nations Security Council Consolidated List](https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list)
- [Sentinel repository](https://github.com/deep-track/Sentinel)
