# Sentinel AML Decision Workflow

## Cover
Sentinel AML Screening
From OFAC and UN watchlists to auditable compliance decisions
Internal engineering briefing — August 2026

## Slide 1
### AML screening is a decision workflow

Sentinel must do more than search a name. It must identify potential watchlist matches, preserve the evidence used, route ambiguity to trained reviewers, and produce a defensible audit record.

Speaker script: “The objective is controlled decisioning. A fuzzy match is a signal for investigation, not an automatic legal conclusion.”

## Slide 2
### The screening request is protected

The `/v1/verify/aml` endpoint requires a valid Sentinel API key. The client identity is derived from that key rather than accepted from the request body.

The request accepts a subject name, entity type, and optional country. The handler validates the payload, checks the client credit balance, creates a tenant-scoped verification, and queues backend screening.

Speaker script: “The API key is the tenant boundary. A caller cannot select another client by changing a client identifier in the JSON body.”

## Slide 3
### Active watchlist versions are the input

The matcher reads only active OFAC SDN and UN Consolidated versions. It rejects a screening request when no active version or no entries are available.

Every entry carries its source, source record ID, source version, primary name, aliases, countries, programs, identifiers, and normalized names.

Speaker script: “The matcher is never allowed to screen against an unvalidated or partially ingested list.”

## Slide 4
### Matching combines exact and fuzzy signals

| Matching signal | Meaning | Initial treatment |
|---|---|---|
| Exact normalized name | Strongest name signal | Compliance escalation |
| Alias match | Match to a published alternate name | Review or escalation |
| Fuzzy similarity | Typographical or ordering variation | Manual review threshold |
| No qualifying match | No active-list candidate above threshold | Pass, subject to other controls |

The current foundation uses normalized names, aliases, and Dice bigram similarity. Candidate results are capped to the strongest 25 matches.

Speaker script: “Multiple signals reduce the risk of relying on a single spelling comparison, while the review threshold prevents a weak similarity from becoming a false positive.”

## Slide 5
### Decision thresholds separate signal from action

The current implementation uses a 70-point threshold to retain a candidate and a 94-point threshold for the strongest matches.

A high-confidence exact or normalized match returns `reject` for compliance escalation. A high-confidence fuzzy match returns `review`, because identity resolution is still required. Other qualifying matches also return `review`.

Speaker script: “These thresholds are engineering defaults. Compliance owners must calibrate them against labeled test cases and document the final policy.”

## Slide 6
### Possible matches become review work

For every non-pass result, Sentinel creates a `reviewQueue` item. For every match, it creates a `flaggedEntities` record containing the source, program, score, matching method, matched country, exact watchlist version, and exact watchlist entry.

Speaker script: “A reviewer must be able to open a case and answer: what matched, where did it come from, how strong was the match, and which version was active?”

## Slide 7
### Audit evidence is written at decision time

The system writes an `aml.screened` audit event with the tenant, verification, subject name, verdict, match count, and source versions. Screening failures write a separate `aml.screening_failed` event and fail the verification rather than returning a clean result.

Speaker script: “The audit record is created by the backend workflow, not by the browser, so the client cannot rewrite the screening history.”

## Slide 8
### The end-to-end request flow

```text
Client API request
        ↓
API-key authentication and tenant resolution
        ↓
Input validation and credit check
        ↓
Queued AML verification
        ↓
Active OFAC/UN entries loaded
        ↓
Normalization and candidate scoring
        ↓
Pass, review, or reject decision
        ↓
Flagged entity + review queue + audit log
        ↓
Status retrieval by tenant-scoped reference
```

Speaker script: “The synchronous API response is a queue acknowledgement. The actual decision is performed in the backend and retrieved through the existing verification status path.”

## Slide 9
### Failure handling is fail-closed

If watchlists are unavailable, no active version exists, or the screening action fails, the verification is marked failed and an operational review signal is recorded. It is not returned as a clean pass.

If a match is uncertain, the result is routed to review rather than automatically rejecting the subject.

Speaker script: “The two dangerous outcomes are a false clear and an untraceable decision. The workflow is designed to avoid both.”

## Slide 10
### What has been implemented

The Convex schema now supports version-linked watchlist entries and flagged entities. The OFAC/UN matcher and persistence layer are deployed to the Deeptrack production Convex deployment. The protected AML HTTP route is implemented, typechecked, built, and its unauthenticated boundary returns HTTP 401.

Speaker script: “The technical path is present and deployed, but production use still requires an authenticated client with credits and end-to-end workflow testing.”

## Slide 11
### Production validation still required

The next acceptance tests should use controlled fixtures to prove a clear name, exact match, alias match, misspelling, ambiguous candidate, no active list, and unavailable source.

Compliance owners must approve the thresholds, the reject-versus-review policy, reviewer permissions, retention rules, and escalation obligations before real customer screening is enabled.

Speaker script: “Engineering can prove the mechanics. Compliance must approve the meaning of the decision states.”

## Slide 12
### Operating model and next milestone

The next milestone is an authenticated end-to-end test that creates one controlled AML verification, confirms the status response, inspects the flagged entity and review item, and verifies the audit event.

After that, Sentinel needs reviewer resolution, webhook delivery, alerting for stale watchlists, matching-quality measurement, and a formal source/version retention policy.

Speaker script: “The matcher is now connected to the decision workflow. The next step is governed operational use, not simply adding more data sources.”

## References

- [Sentinel repository](https://github.com/deep-track/Sentinel)
- [OFAC SDN list](https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML)
- [UN Security Council Consolidated List](https://scsanctions.un.org/resources/xml/en/consolidated.xml)
