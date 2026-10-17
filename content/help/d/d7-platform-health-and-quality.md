---
id: d7
title: Platform health and quality
summary: Check that Sentinel's services, settings and watchlists are working, follow screening runs and judge the quality of DeepTrack Live results.
roles: Internal admin, Internal reviewer
---

## What it's for

Three Back Office screens tell you whether Sentinel is working and whether its results can be trusted:

- **Service health**: are the outside services up, are the settings they need present, are the watchlists fresh, and how did real traffic fare in the last 7 days.
- **Screening monitor**: AML screening runs and the review queue over the last 7 days.
- **Model & data quality**: how DeepTrack Live, the face and deepfake check, performed month by month, and each watchlist's download history.

Use them at the start of an on-call shift, after a deploy, and when a client reports slow or odd results.

## Who can use it

Back Office access comes from Auth0 roles. Internal admins hold internal_admin, administrator, head or admin. Internal reviewers hold reviewer, compliance_analyst or compliance_reviewer. The view_only role removes write access.

| Screen | Who can view | Who can act |
|---|---|---|
| **Service health** | Internal admins and internal reviewers | Internal admins without view_only: **Run checks now** and **Resend**. Others don't see these buttons. |
| **Screening monitor** | Internal admins and internal reviewers | Nobody. Read-only. |
| **Model & data quality** | Internal admins and internal reviewers | Nobody. Read-only. |

Both actions are checked again on the server and written to the audit log.

## Step by step

### Check service health

1. In the Back Office sidebar, under **Back office**, click **Service health**.
2. Read the status at the top right. "All services up · configuration complete" means nothing needs you. Otherwise it says how many services are down and how many required settings are missing.
3. In **External services**, read each row: **DeepTrack Live**, **OpenSanctions** and **Scanning service (doc scan · IPRS · liveness)**. Each shows its **Status**, **Last check**, **Up (24 h)**, **Response** time and **Detail**.
4. Sentinel probes them every 15 minutes. After a fix, click **Run checks now** instead of waiting. You see "Checks started. Results appear here within a few seconds."

![Service health with all three services up](/help/shots/d7-services.png "TODO")

### Read the configuration panel

**Configuration** lists the settings each service needs in the Convex deployment. Sentinel shows only whether each one is present, never its value, and this manual does the same. Under each label you see the setting's name, so engineering knows what to set.

1. Look for any **Missing** badge. Required settings are the OpenSanctions API key, UN watchlist URL, DeepTrack Live URL, DeepTrack Live API key, scanning service URL, scanning service token and liveness link base URL.
2. **Not set (optional)** is fine unless a client uses that feature: MetaMap for BRS company lookups, KRA GavaConnect for KRA PIN checks, Africa's Talking or Twilio for liveness texts and WhatsApp, the Claude API key for adverse media, and the EU and UK list overrides (both have built-in defaults).
3. To fix a setting, ask engineering on-call to set it in the deployment's environment. Never paste a key or token into a ticket, chat or this page.

### Check watchlists and real traffic

1. In **Watchlists**, each list shows **Records**, **Last refreshed** and a status. A red line under the status is the last download error.
2. Read the tiles: **Verifications, 7 days**, **Held by outages**, **OpenSanctions gaps** and **Watchlist gaps**.
3. **Failed scan steps** names the service behind each failure, for example "IPRS (scanning service)".
4. **Speed and failures by type** gives each check type's volume, failure rate, review rate, **Median** and **p95** completion time. **Slowest clients** lists the 10 clients with the highest p95.
5. **Liveness texts** shows texts sent, delivered and failed, with failure reasons.

### Resend a failed webhook

1. In **Client webhooks**, find the row by client and **Scan ID**. **Last response** shows the client's HTTP status, or "No response".
2. Fix the cause with the client first, for example a wrong URL or an expired certificate (see [C7 Webhooks](/help/c7)).
3. Click **Resend**. Sentinel resets the attempt count and sends it again.

### Follow screening runs

1. Under **Reviews**, click **Screening monitor**. The page is titled **AML Screening Monitor** and covers the last 7 days.
2. Read the tiles: **Pending review**, **In review**, **High priority** and **Screening failures**.
3. **Screening outcomes** splits screenings into **Pass**, **Review** and **Reject**.
4. **Recent screening audit events** lists the newest 25 screenings and failures. A failure shows its reason.
5. **Review queue** lists the newest 25 review items with priority, status and reason.

Times on this page come from the server, so they may show UTC rather than EAT (UTC+3).

![AML Screening Monitor with Demo Bank Ltd screenings](/help/shots/d7-screening-monitor.png)

### Judge the quality of results

1. Under **Risk & compliance**, click **Model & data quality**.
2. Read the tiles for this month: **DeepTrack Live checks this month**, **Judged fake**, **Service errors** and **Overturned by reviewers**.
3. **DeepTrack Live by month** shows six months of selfie and video checks, each with a coloured mix of **Real**, **Uncertain**, **Fake** and **Service error**, plus how many went to review and how many a reviewer overturned.
4. **Watchlist freshness** shows each list's record count over time and its last 10 runs, with the change in records.

![Model & data quality with six months of DeepTrack Live results](/help/shots/d7-quality.png)

### Recurring tasks

- [ ] Daily: on **Service health**, confirm all three services are **Up** and nothing is **Missing**.
- [ ] Daily: after 07:45 EAT, when the last list has refreshed, confirm every watchlist is **Current**.
- [ ] Daily: on **Screening monitor**, check **Screening failures** is 0 and **High priority** items are being worked.
- [ ] Daily: on **Service health**, resend failed webhooks once the client has fixed the cause.
- [ ] Weekly: read **Speed and failures by type** and **Slowest clients**, and raise anything worse than last week.
- [ ] Monthly: on **Model & data quality**, compare **Judged fake**, **Service errors** and **Overturned by reviewers** with the month before and share them with the DeepTrack Live team.

## What each result means

### Services and settings

| What you see | Meaning | What to do |
|---|---|---|
| **Up** | The last probe got a good answer. | Nothing. |
| **Down** | The last probe failed. **Detail** says why. | Read the detail, then tell engineering on-call. |
| **Not checked** | No probe has run yet, for example just after a deploy. | Click **Run checks now**. |
| "API key rejected (HTTP 401)" or "(HTTP 403)" | The service refused DeepTrack's key. | The key needs replacing or the account is suspended. |
| "Service unavailable or suspended (HTTP 503)" | The service is down or the account is on hold. | Check the vendor's status page and account. |
| "No response within 10s" or "Unreachable" | No answer at all. | Check the vendor's status and the URL setting. |
| "Reachable, but … is not set" | The service answers but its key is missing. | Set the key. |
| **Set** / **Missing** / **Not set (optional)** | A setting is present, a required one is absent, or an optional one is absent. | Fix **Missing** first. |

### Watchlists

- **Current**: the active copy is fresh.
- **Stale**: older than 3 days for a daily list (14 for a weekly one). Screenings can't pass on their own while a list is stale.
- **Unavailable**: no usable copy. Screenings go to review.

On **Model & data quality**, a run is **active** (in use), **superseded** (replaced by a newer run), **failed** or **pending**. A falling record count is shown in amber: check the source before trusting it.

### Traffic tiles

- **Held by outages**: review items opened in 7 days because a service failed, timed out or wasn't configured. Those clients waited for a person.
- **OpenSanctions gaps**: AML screenings that finished without OpenSanctions.
- **Watchlist gaps**: AML screenings that finished with a list missing.

### DeepTrack Live outcomes

**Real**, **Uncertain** and **Fake** are DeepTrack Live's verdicts. **Service error** means the check couldn't run. **Overturned by reviewers** counts checks a reviewer labelled as a false accept or false reject. Error rates by device and skin-tone group aren't shown yet.

### When things run (UTC)

| Job | When |
|---|---|
| OFAC, UN, EU and UK list downloads | Daily at 03:15, 03:45, 04:15 and 04:45 |
| Service probes | Every 15 minutes, kept 7 days |
| Ongoing monitoring re-screens | Every 15 minutes; an incomplete re-screen retries after an hour |
| Weekly compliance report | Mondays at 04:30 |

## Common questions

### Can I see the value of a setting?

No. The screen shows presence only, by design. Ask engineering to check the value in the deployment.

### Do probes cost money?

No. The OpenSanctions probe uses its free health endpoint, and the others make no billable check.

### Why doesn't the Screening monitor show monitoring alerts?

It counts first screenings and failures only. Ongoing monitoring alerts appear in the client's review queue and in the **Compliance** audit log under `aml.monitoring_alert`.

### Why is "Pending review" lower than the review queue?

The Screening monitor counts only items created in the last 7 days. Older open items are in the review queue (see D2).

### Does Resend charge the client?

No. It sends the same result again.

## Related chapters

- [D1 The Back Office at a glance](/internal-ops/help/d1)
- [D2 Review queue and disputes](/internal-ops/help/d2)
- [D5 Kenyan risk lists and FATF countries](/internal-ops/help/d5)
- [D6 Compliance tasks](/internal-ops/help/d6)
- [B4 Remote liveness](/help/b4)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [B10 Fraud signals explained](/help/b10)
- [C7 Webhooks](/help/c7)
