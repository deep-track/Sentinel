---
id: c4
title: AML and monitoring API
summary: Screen people and companies from your own systems, enrol them for ongoing monitoring, and list or remove monitored subjects.
roles: Developer, Admin
---

## What it's for

The AML API lets your systems screen a person or a company the moment they apply, without anyone opening Sentinel. AML screening (anti-money laundering screening) checks the subject against sanctions lists, PEP data (PEP: politically exposed person, someone who holds or held a prominent public role), Kenyan risk lists and adverse media. It uses the same sources, matching and rules as a screening run on the **AML Screening** page. See [B6 AML screening](/help/b6).

The same call can enrol the subject for ongoing monitoring. Sentinel then re-screens them on a schedule and tells you only when something new or more severe appears. See [B7 Ongoing monitoring](/help/b7).

This chapter covers four calls:

| Call | What it does |
|---|---|
| `POST /v1/verify/aml` | Screen a subject, and optionally enrol them for monitoring. |
| `GET /v1/monitoring/subjects` | List your actively monitored subjects. |
| `GET /v1/monitoring/subjects/{id}` | Read one monitored subject. |
| `DELETE /v1/monitoring/subjects/{id}` | Stop monitoring a subject. |

Screening is asynchronous. The POST returns at once with an id, and you collect the result from a webhook or from `GET /v1/verify/{id}`.

Authentication, test mode, rate limits and the general error format are in [C1 Quick start](/help/c1). This chapter covers only what is specific to AML.

## Who can use it

- Any system holding a valid API key for your organization, with the right scope.
- An **Admin** or **Developer** creates keys and picks their scopes on the **API Keys** page. Everyone else can see the keys but can't change them.
- The scopes these calls need:

| Call | Scope (as shown on the API Keys page) |
|---|---|
| `POST /v1/verify/aml` | **Run AML screenings** |
| `GET` and `DELETE /v1/monitoring/subjects` | **Manage AML monitoring** |
| `GET /v1/verify/{id}` (to read the result) | **Read check results** |

A key created before scopes existed can call every endpoint. A key without the needed scope gets a 403.

![API Keys page with a key that has the Run AML screenings and Manage AML monitoring scopes](/help/shots/c4-api-key-scopes.png "TODO")

## Step by step

All examples read the key from the `SENTINEL_API_KEY` environment variable, for example `gt_test_...` for a test key. Replace `<your-sentinel-host>` with the API host shown for your organization.

### Screen a person

Send the full name and `entityType: "individual"`. Add a date of birth or ID number when you have one: without them, matching is on name and country only and you get more look-alikes to review.

#### curl

```bash
curl -X POST "https://<your-sentinel-host>/v1/verify/aml" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subjectName": "Wanjiku Kamau",
    "entityType": "individual",
    "country": "KE",
    "dateOfBirth": "1988-04-12",
    "idNumber": "23456789",
    "aliases": ["Wanjiku Njeri Kamau"]
  }'
```

#### Node

```javascript
const res = await fetch("https://<your-sentinel-host>/v1/verify/aml", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    subjectName: "Wanjiku Kamau",
    entityType: "individual",
    country: "KE",
    dateOfBirth: "1988-04-12",
    idNumber: "23456789",
    aliases: ["Wanjiku Njeri Kamau"],
  }),
});
const screening = await res.json();
console.log(res.status, screening.id);
```

#### Python

```python
import os
import requests

res = requests.post(
    "https://<your-sentinel-host>/v1/verify/aml",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={
        "subjectName": "Wanjiku Kamau",
        "entityType": "individual",
        "country": "KE",
        "dateOfBirth": "1988-04-12",
        "idNumber": "23456789",
        "aliases": ["Wanjiku Njeri Kamau"],
    },
)
screening = res.json()
print(res.status_code, screening["id"])
```

### Screen a company and enrol it for monitoring

Use `entityType: "entity"`, the BRS registration number and the country of incorporation. Set `monitor: true` and pass your own customer id in `externalRef`.

#### curl

```bash
curl -X POST "https://<your-sentinel-host>/v1/verify/aml" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subjectName": "Savannah Fresh Produce Ltd",
    "entityType": "entity",
    "registrationNumber": "PVT-AB1CD2E",
    "jurisdiction": "KE",
    "monitor": true,
    "externalRef": "CUST-1001"
  }'
```

#### Node

```javascript
const res = await fetch("https://<your-sentinel-host>/v1/verify/aml", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    subjectName: "Savannah Fresh Produce Ltd",
    entityType: "entity",
    registrationNumber: "PVT-AB1CD2E",
    jurisdiction: "KE",
    monitor: true,
    externalRef: "CUST-1001",
  }),
});
const { id, monitoringId } = await res.json();
```

#### Python

```python
res = requests.post(
    "https://<your-sentinel-host>/v1/verify/aml",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={
        "subjectName": "Savannah Fresh Produce Ltd",
        "entityType": "entity",
        "registrationNumber": "PVT-AB1CD2E",
        "jurisdiction": "KE",
        "monitor": True,
        "externalRef": "CUST-1001",
    },
)
body = res.json()
print(body["id"], body["monitoringId"])
```

Store the `monitoringId` (it starts with `mon_`) against your customer. If you screen the same customer again with the same `externalRef` and `monitor: true`, Sentinel updates the existing monitored subject and returns the same `monitoringId`. It doesn't create a second one.

If you leave `monitor` out, your organization's default applies. An Admin sets it with **Monitor every new AML screening by default** in **Settings** → **Screening rules**. Send `monitor: false` to be sure a subject is not enrolled.

### Collect the result

1. Wait for the `sentinel.scan.complete` webhook ([C7 Webhooks](/help/c7)), or poll `GET /v1/verify/{id}` with the `id` from the POST ([C6 Results and credits](/help/c6)).
2. When `status` is `completed`, read `verdict` and the `screening` object described under "What each result means".

```bash
curl "https://<your-sentinel-host>/v1/verify/ver_..." \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

When monitoring finds a change later, Sentinel creates a new AML screening for the subject and sends it as a `sentinel.monitoring.alert` webhook. Its `result.monitoring` block names the monitored subject (`reference`), your `externalRef`, and the hits that are `added` or `escalated`. The alert also opens a review case for your team.

### List monitored subjects

Returns your actively monitored subjects, newest first. Use `limit` (1 to 100, default 50) and pass `nextCursor` back as `before` to get the next page.

#### curl

```bash
curl "https://<your-sentinel-host>/v1/monitoring/subjects?limit=50" \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
let before;
do {
  const url = new URL("https://<your-sentinel-host>/v1/monitoring/subjects");
  url.searchParams.set("limit", "100");
  if (before) url.searchParams.set("before", String(before));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
  });
  const page = await res.json();
  for (const subject of page.subjects) console.log(subject.id, subject.externalRef);
  before = page.nextCursor;
} while (before);
```

#### Python

```python
before = None
while True:
    params = {"limit": 100}
    if before:
        params["before"] = before
    page = requests.get(
        "https://<your-sentinel-host>/v1/monitoring/subjects",
        headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
        params=params,
    ).json()
    for subject in page["subjects"]:
        print(subject["id"], subject["externalRef"])
    before = page["nextCursor"]
    if not before:
        break
```

To read one subject, call `GET /v1/monitoring/subjects/mon_...`. This also works for a subject you have stopped monitoring.

### Stop monitoring a subject

Call this when the customer relationship ends. It takes effect at once. Past screenings and alerts stay in Sentinel.

#### curl

```bash
curl -X DELETE "https://<your-sentinel-host>/v1/monitoring/subjects/mon_..." \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
const res = await fetch(
  `https://<your-sentinel-host>/v1/monitoring/subjects/${monitoringId}`,
  {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
  },
);
console.log(res.status, await res.json()); // 200 { id, status: "removed" }
```

#### Python

```python
res = requests.delete(
    f"https://<your-sentinel-host>/v1/monitoring/subjects/{monitoring_id}",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
)
print(res.status_code, res.json())
```

Calling it again for a subject that is already stopped also returns 200. The subject then disappears from the **Monitored subjects** panel on the **AML Screening** page.

![Monitored subjects panel listing subjects enrolled through the API](/help/shots/c4-monitored-subjects.png "TODO")

## What each result means

### Request fields for POST /v1/verify/aml

| Field | Required | Rules |
|---|---|---|
| `subjectName` | Yes | Full name, at most 300 characters. |
| `entityType` | Yes | `individual` or `entity` (a company). |
| `country` | No | ISO code or country name, at most 100 characters. |
| `aliases` | No | Array of up to 10 other names, each at most 300 characters. |
| `dateOfBirth` | No | Individuals only. `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. |
| `nationality` | No | Individuals only. ISO code or name, at most 100 characters. |
| `idNumber` | No | Individuals only. National ID or passport number, at most 100 characters. |
| `registrationNumber` | No | Entities only. For example `PVT-AB1CD2E`, at most 100 characters. |
| `jurisdiction` | No | Entities only. Country of incorporation, at most 100 characters. |
| `monitor` | No | `true` to enrol for ongoing monitoring. Left out: your organization's default. |
| `externalRef` | No | Your customer id, at most 100 characters. Only allowed when the subject is monitored. |

### Response to POST /v1/verify/aml (202)

| Field | Meaning |
|---|---|
| `id` | The screening's reference, `ver_...`. Use it with `GET /v1/verify/{id}`. |
| `type` | Always `aml`. |
| `status` | `queued` with a live key. `completed` with a test key. |
| `verdict`, `sandbox` | Only with a test key: `verdict` is `pass` and `sandbox` is `true`. |
| `monitoringId` | The monitored subject's id, `mon_...`, or `null` when the subject isn't monitored. Always `null` with a test key. |

### The screening result

`GET /v1/verify/{id}` returns `status` (`queued`, `processing`, `completed` or `failed`) and `verdict`. For a completed AML screening it also returns a `screening` object.

| Verdict | Shown in Sentinel | What to do |
|---|---|---|
| `pass` | **Clear** | Continue onboarding. |
| `review` | **Needs review** | A review case is open. Wait for your team's decision, delivered by the `sentinel.review.decided` or `sentinel.scan.complete` webhook. |
| `reject` | **Match** | A strong sanctions match. Don't onboard or transact. |

| `screening` field | Meaning |
|---|---|
| `reason` | The decision in plain words. |
| `categories` | Hits per category: `sanctions`, `pep`, `special_interest`, `fitness_probity`, `adverse_media`, `insolvency`, with the most severe PEP class. |
| `sources.watchlists` | Each sanctions list screened, with `stale: true` if its copy was too old. |
| `sources.openSanctions` | `screened`, `unavailable` or `not_configured`. |
| `matches[]` | One entry per hit: `source`, `sourceRecordId`, `entityName`, `program`, `matchScore` (0 to 100), `riskLevel` (`critical` or `high`), `matchedCountry`, `topics`, `categories`, `pepClass` (1 to 4) and `birthDateMatch`. |

### Monitored subject fields

| Field | Meaning |
|---|---|
| `id` | `mon_...` |
| `status` | `active`, or `removed` after you stop monitoring. The list returns active subjects only. |
| `subjectName`, `entityType`, `country`, `externalRef` | As enrolled. |
| `hits` | Current hits: `key`, `entityName`, `categories`, and `pepClass` for PEP hits. Up to 50 are kept. |
| `screenCount`, `alertCount` | Complete screenings run for this subject, including the enrolment screening, and alerts raised. |
| `lastScreenedAt`, `lastAlertAt`, `nextScreenAt`, `createdAt`, `removedAt` | Times in milliseconds since 1 January 1970 (UTC), or `null`. `nextScreenAt` is `null` once removed. |

The list response is `{ "subjects": [...], "nextCursor": 1760600000000 }`. `nextCursor` is `null` on the last page.

### Errors specific to these calls

| Status | Message | What to do |
|---|---|---|
| 400 | `Missing required fields: subjectName, entityType` | Send both. |
| 400 | `Invalid fields: ...` with a `details` object | Fix the named fields. `details` lists the rule for each. |
| 400 | `Date of birth applies to individuals only.` and similar | Send person fields only for `individual`, company fields only for `entity`. |
| 400 | `A customer reference is only used with monitor: true.` | Drop `externalRef`, or set `monitor: true`. |
| 400 | `Missing or invalid monitored subject id` | The id must look like `mon_` followed by letters and digits. |
| 402 | `Insufficient credits` | Top up. Nothing was created. |
| 403 | `This API key can't call ...` | Give the key the scope named in the message. |
| 404 | `Monitored subject not found` | The id is wrong or belongs to another organization. |

## Common questions

### How many credits does a screening cost?

One credit on plans billed in Kenya shillings. On USD plans, 60 credits on Starter (and Trial), 50 on Growth, 40 on Business and 35 on Enterprise. Monitoring re-screenings and alerts are free. Test keys are never charged. See [C6 Results and credits](/help/c6).

### Can I test monitoring with a test key?

Not fully. A test key returns a completed `pass` result straight away and never enrols the subject, so `monitoringId` is always `null`. Use a live key on a known customer to see real monitoring.

### Do the monitoring calls see subjects my team enrolled in Sentinel?

Yes. The API and the **AML Screening** page share one list of monitored subjects. A subject stopped through the API shows as **Stopped** on its report in Sentinel.

### How often are monitored subjects re-screened?

Daily by default. An Admin can choose **Daily**, **Weekly** or **Monthly** in **Settings** → **Screening rules**. `nextScreenAt` tells you when each subject is next due.

### Why is a new subject's hits list empty?

The baseline is set when the enrolment screening has screened every list. Until then `hits` is empty and `lastScreenedAt` is `null`. If the subject had no hits at all, `hits` stays empty after that too.

### How do I restart monitoring after a DELETE?

Send a new `POST /v1/verify/aml` with `monitor: true`. It is charged as a normal screening and sets a new baseline.

## Related chapters

- [C1 Quick start](/help/c1)
- [C5 Transactions API](/help/c5)
- [C6 Results and credits](/help/c6)
- [C7 Webhooks](/help/c7)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [A7 Screening rules](/help/a7)
