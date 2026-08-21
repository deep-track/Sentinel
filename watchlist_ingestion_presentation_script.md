# Sentinel Watchlist Ingestion Architecture

## Cover
Sentinel Watchlist Ingestion
From published sanctions data to auditable screening decisions
Internal engineering briefing — August 2026

## Slide 1
### Why watchlist ingestion matters

Sentinel is intended to screen verified individuals and entities against sanctions and high-risk watchlists as part of KYC, KYB, and AML workflows.

The operational goal is not simply to return a match score. Sentinel must be able to explain which source, version, record, and review decision produced an outcome.

Speaker script: “A sanctions result is only as defensible as the data lineage behind it. This chamber creates the foundation for current, versioned, auditable watchlist data.”

## Slide 2
### The target source set

| Source | Refresh cadence | Role |
|---|---:|---|
| OFAC SDN | Daily | U.S. Treasury designated nationals |
| UN Security Council Consolidated List | Daily | UN sanctions regimes |
| FBI Most Wanted | Weekly, future phase | Federal fugitives and high-risk criminal subjects |

Speaker script: “The first implementation focuses on OFAC and the UN Consolidated List. FBI ingestion remains a planned extension, not a claim about the current implementation.”

## Slide 3
### The ingestion chamber

Scheduled Convex jobs run the deterministic pipeline:

1. Fetch the approved HTTPS source.
2. Reject HTTP failures and suspiciously small responses.
3. Parse source-specific XML.
4. Normalize names, aliases, countries, programs, and identifiers.
5. Hash the source payload.
6. Write records in bounded batches.
7. Promote only a complete version to active.

Speaker script: “The chamber separates downloading, normalization, persistence, and activation. A partial import is never allowed to replace the last known-good version.”

## Slide 4
### Convex scheduling

Two daily jobs are registered in `convex/crons.ts`:

```ts
crons.cron("ingest OFAC SDN watchlist", "15 3 * * *", internal.watchlists.ingestOfac, {});
crons.cron("ingest UN consolidated watchlist", "45 3 * * *", internal.watchlists.ingestUn, {});
```

The jobs are staggered by thirty minutes to reduce simultaneous source traffic and simplify operational diagnosis.

Speaker script: “These are deterministic backend jobs, so they run in the application backend rather than relying on a human or a browser session.”

## Slide 5
### Versioned data model

| Table | Purpose |
|---|---|
| `watchlistSources` | Source configuration and last-run health |
| `watchlistVersions` | Immutable import attempt and activation state |
| `watchlistEntries` | Normalized records tied to a specific version |
| `flaggedEntities` | Tenant-linked screening hits |
| `reviewQueue` | Human review workflow |
| `auditLog` | Evidence of system and reviewer actions |

Speaker script: “Versioning is the key control. A review record can later identify not only the matched subject but also the exact source version that was active at the time.”

## Slide 6
### Activation is fail-closed

An import moves through four states:

- `pending` while the source is being fetched and written
- `active` only after validation and all batches succeed
- `superseded` when a newer complete version replaces it
- `failed` when the source or parser fails

A failed import leaves the previous active version in place. An empty or malformed source does not become a clean watchlist.

Speaker script: “Operational failure must create a visible pending or degraded state. It must never silently produce a false-clear compliance result.”

## Slide 7
### Source adapters are intentionally separate

OFAC and UN data do not share the same XML structure, so each source has its own parser. Both parsers produce the same normalized record shape:

```text
sourceRecordId
entityType
primaryName
aliases
normalizedNames
countries
programs
identifiers
```

Speaker script: “Source-specific parsing prevents the normalized database from becoming coupled to one provider’s field names while giving the matcher a stable contract.”

## Slide 8
### What is implemented today

The repository now contains the Convex schema additions, OFAC and UN ingestion actions, daily cron registrations, batch writes, content hashing, version activation, and failure tracking.

The code was typechecked, the Next.js build passed, and the Convex production deployment completed against the Deeptrack `platform` deployment.

Speaker script: “This is a deployed ingestion foundation. It is not yet a completed regulatory-grade screening product.”

## Slide 9
### What remains before production claims

The current chamber still needs official fixture testing and operational hardening:

- Validate parsers against current OFAC and UN XML fixtures.
- Configure and monitor the UN source URL.
- Add retry backoff, source checksums/manifests, and alerting.
- Add durable fuzzy matching and exact/alias matching.
- Link each screening decision to its source version.
- Complete AML route, review actions, audit exports, and retention policy.

Speaker script: “The code protects the activation boundary, but production readiness depends on monitoring, test fixtures, matching quality, and workflow completeness.”

## Slide 10
### Provider lookup versus owned ingestion

Sentinel also contains an OpenSanctions live-search adapter. Sanctions.io is another possible provider integration. These are not equivalent to Sentinel-owned ingestion.

| Approach | Data ownership | Current state |
|---|---|---|
| OpenSanctions live search | Provider | Adapter exists |
| Sanctions.io live search | Provider | Separate integration option |
| OFAC/UN owned ingestion | Sentinel | Foundation implemented |

Speaker script: “The architecture decision must be explicit. A provider lookup, a local database, or defense in depth each has different cost, freshness, audit, and operational responsibilities.”

## Slide 11
### Acceptance test

The release acceptance test should prove four things:

1. A successful OFAC import creates a complete active version and entries.
2. A successful UN import creates a separate active version and entries.
3. A malformed, empty, or failed import creates a failed version and preserves the previous active version.
4. A verification produces a flagged entity and review-queue item linked to the active source version.

Speaker script: “The most important test is the failure test. We need proof that bad source data cannot replace good data and cannot be interpreted as a clean result.”

## Slide 12
### Closing decision

Sentinel now has the first version of a controlled watchlist-ingestion chamber.

The immediate decision is whether to complete Sentinel-owned OFAC/UN screening or to use a provider such as OpenSanctions or Sanctions.io as the primary screening engine.

Either choice must preserve tenant isolation, source/version lineage, human review, auditability, and fail-closed handling.

Speaker script: “The chamber is the foundation. The next milestone is not another dashboard—it is end-to-end AML screening with measured matching quality and an auditable reviewer workflow.”

## References

- [Sentinel Backend Engineering Document](../upload/Sentinel_Backend_Engineering_Doc(1).pdf)
- [OFAC SDN list](https://sanctionslist.ofac.treas.gov/Home/SdnList)
- [UN Security Council Consolidated List](https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list)
- [Sentinel repository](https://github.com/deep-track/Sentinel)
