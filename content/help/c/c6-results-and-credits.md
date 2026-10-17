---
id: c6
title: Results and credits
summary: Fetch a check's result by its id, list your checks page by page, and read your credit balance, prices and credit ledger over the API.
roles: Developer, Admin
---

## What it's for

Every check you start over the API returns an `id` such as `ver_3f9a1c0b7d2e4a51c6e08b9d4f2a7e13`. This chapter shows how to use that id to fetch the result, how to list your organization's checks, and how to read your credits: the balance, what each check costs on your plan, and the ledger of every credit added or used.

Most integrations get results from [C7 Webhooks](/help/c7) as soon as a check finishes. Use these calls to poll when a webhook is late, to reconcile at the end of the day, or to show your balance in your own back office.

For the API key, test mode, rate limits and the error format, see [C1 Quick start](/help/c1).

## Who can use it

- Any API key of your organization with the right scope. In **Settings** → **Developers**, a key needs **Read check results** (`results:read`) for the `GET /v1/verify` calls and **Read credits and usage** (`credits:read`) for the `GET /v1/credits` calls. Keys created before scopes existed can call everything.
- **Admin** and **Developer** create keys and choose their scopes.
- Live and test keys read the same records. A test key can fetch a live check's result and the real balance, so keep test keys as private as live ones.
- These calls are free. Reading results or credits never uses credits.

## Step by step

All examples read the key from the `SENTINEL_API_KEY` environment variable, for example `export SENTINEL_API_KEY=gt_test_...`. Replace `<your-sentinel-host>` with your Sentinel API host (see [C1 Quick start](/help/c1)).

### Fetch one result

1. Take the `id` returned when you started the check (or `scan_id` from a webhook).
2. Call `GET /v1/verify/{id}`.
3. Read `status`. If it is `queued` or `processing`, wait and try again, or wait for the webhook. When it is `completed`, read `verdict`. When it is `failed`, read `failureReason`.

#### curl

```bash
curl https://<your-sentinel-host>/v1/verify/ver_3f9a1c0b7d2e4a51c6e08b9d4f2a7e13 \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
// Node 18+; save as get-result.mjs
const res = await fetch("https://<your-sentinel-host>/v1/verify/ver_3f9a1c0b7d2e4a51c6e08b9d4f2a7e13", {
  headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
});
const check = await res.json();
if (!res.ok) throw new Error(`${res.status}: ${check.error}`);
console.log(check.status, check.verdict);
```

#### Python

```python
import os
import requests

res = requests.get(
    "https://<your-sentinel-host>/v1/verify/ver_3f9a1c0b7d2e4a51c6e08b9d4f2a7e13",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    timeout=30,
)
check = res.json()
res.raise_for_status()
print(check["status"], check["verdict"])
```

A completed AML screening also carries a `screening` object (reason, hit counts per category, sources screened and matches). A completed document check carries a `document` object (reason, risk score, the fields read and the checks run). Their fields are described in [C4 AML and monitoring API](/help/c4) and [C3 Documents API](/help/c3).

### List your checks

1. Call `GET /v1/verify`. Add any of the query parameters below.
2. Read `data`, newest first.
3. If `nextCursor` is not `null`, call again with `before=<nextCursor>` for the next page. Stop when `nextCursor` is `null`.

| Parameter | Values | Default |
|---|---|---|
| `status` | `queued`, `processing`, `completed`, `failed` | all |
| `type` | `idp`, `document`, `aml`, `kyb`, `liveness`, `kyi` | all |
| `limit` | whole number from 1 to 100 | 25 |
| `before` | the `nextCursor` from the previous page | first page |

When you filter by `status`, a page can hold fewer rows than `limit`, or none, while `nextCursor` is still set. Keep paging until `nextCursor` is `null`.

#### curl

```bash
curl "https://<your-sentinel-host>/v1/verify?type=aml&status=completed&limit=50" \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
// Node 18+; save as list-checks.mjs. Walks every page.
const base = "https://<your-sentinel-host>/v1/verify";
const headers = { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` };
let before = null;
do {
  const url = new URL(base);
  url.searchParams.set("type", "aml");
  url.searchParams.set("limit", "100");
  if (before !== null) url.searchParams.set("before", String(before));
  const res = await fetch(url, { headers });
  const page = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${page.error}`);
  for (const check of page.data) console.log(check.id, check.status, check.verdict);
  before = page.nextCursor;
} while (before !== null);
```

#### Python

```python
import os
import requests

url = "https://<your-sentinel-host>/v1/verify"
headers = {"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"}
params = {"type": "aml", "limit": 100}
while True:
    res = requests.get(url, headers=headers, params=params, timeout=30)
    res.raise_for_status()
    page = res.json()
    for check in page["data"]:
        print(check["id"], check["status"], check["verdict"])
    if page["nextCursor"] is None:
        break
    params["before"] = page["nextCursor"]
```

### Read your credit balance and prices

1. Call `GET /v1/credits`.
2. Read `balance` (in credits) and `balanceValue` (what it is worth in your billing currency on your plan).
3. Read `prices` for what each kind of check costs on your plan.

#### curl

```bash
curl https://<your-sentinel-host>/v1/credits \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
const res = await fetch("https://<your-sentinel-host>/v1/credits", {
  headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
});
const credits = await res.json();
console.log(`${credits.balance} credits, worth ${credits.currency} ${credits.balanceValue}`);
```

#### Python

```python
import os
import requests

res = requests.get(
    "https://<your-sentinel-host>/v1/credits",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    timeout=30,
)
res.raise_for_status()
credits = res.json()
print(credits["balance"], credits["currency"], credits["balanceValue"])
```

A response for a KES client on the Business plan looks like this:

```json
{
  "balance": 1250,
  "currency": "KES",
  "creditPrice": 40,
  "planBonus": 0.15,
  "balanceValue": 43478.26,
  "plan": "business",
  "prices": [
    { "service": "kyc_identity", "credits": 1, "amount": 34.78 },
    { "service": "aml", "credits": 1, "amount": 34.78 },
    { "service": "kyb", "credits": 5, "amount": 173.91 }
  ]
}
```

### Read the credit ledger

1. Call `GET /v1/credits/ledger`. It takes `limit` (1 to 100, default 25) and `before`, the same way as the list of checks.
2. Read `data`, newest first. Page with `nextCursor` until it is `null`.

#### curl

```bash
curl "https://<your-sentinel-host>/v1/credits/ledger?limit=100" \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node

```javascript
const res = await fetch("https://<your-sentinel-host>/v1/credits/ledger?limit=100", {
  headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
});
const { data, nextCursor } = await res.json();
for (const entry of data) console.log(entry.createdAt, entry.type, entry.amount, entry.reason);
```

#### Python

```python
import os
import requests

res = requests.get(
    "https://<your-sentinel-host>/v1/credits/ledger",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    params={"limit": 100},
    timeout=30,
)
res.raise_for_status()
for entry in res.json()["data"]:
    print(entry["createdAt"], entry["type"], entry["amount"], entry["reason"])
```

People without API access see the same ledger, with each line's money value and a link to the check, under **Billing & Credits** in the sidebar.

![Billing & Credits page for Demo Bank Ltd with the credit ledger](/help/shots/c6-billing-ledger.png)

## What each result means

### A check (`GET /v1/verify/{id}` and each row of `GET /v1/verify`)

| Field | What it holds |
|---|---|
| `id` | The check's id, `ver_` followed by 32 hexadecimal characters. |
| `type` | `idp` KYC identity check, `document` document check, `aml` AML screening, `kyb` business check, `liveness` liveness check, `kyi` retired (old records only). |
| `status` | `queued`, `processing`, `completed` or `failed`. |
| `verdict` | `pass`, `review` or `reject` once completed; `null` before that and on failed checks. |
| `confidence` | 0 to 1, or `null`. |
| `createdAt`, `completedAt` | Unix time in milliseconds. `completedAt` is `null` until the check finishes. |
| `failureReason` | Single check only. Why a failed check failed, otherwise `null`. |
| `sandbox` | Single check only. `true` for a check started with a test key. The list doesn't show this. |
| `screening`, `document` | Single check only, on completed AML and document checks. |

| Verdict | What it means | What you do |
|---|---|---|
| `pass` | Every step passed. | Go ahead. |
| `review` | Held for a person. The verdict can change when the case is decided. | Wait for the review webhook, or fetch again later. |
| `reject` | Rejected. | Don't onboard. |

### Credits (`GET /v1/credits`)

| Field | What it holds |
|---|---|
| `balance` | Credits left. |
| `currency` | `USD` or `KES`, your billing currency. |
| `creditPrice` | List price of one credit: USD 0.01 or KES 40. |
| `planBonus` | Bonus credits your plan adds to a payment, as a fraction (KES Business: `0.15`). |
| `balanceValue` | What the balance is worth on your plan, after the bonus. |
| `plan` | `trial`, `starter`, `growth`, `business` or `enterprise`. |
| `prices` | One row per service: `service`, `credits` per check and `amount` in your currency. Services are `kyc_identity`, `identity_document`, `proof_of_address`, `liveness`, `aml` and `kyb`. |

### Ledger entries (`GET /v1/credits/ledger`)

| Field | What it holds |
|---|---|
| `type` | `allocation` (credits added: a paid invoice, trial credits), `deduction` (a check), `refund` (credits returned), `adjustment` (a manual correction, either way). |
| `amount` | Signed credits: negative for a deduction, positive when added. |
| `reason` | Plain text, for example "AML sanctions screening: pass — 1 credit, KES 34.78 on business". |
| `verificationId` | An internal identifier of the check for a deduction, else `null`. It is not the check's `id` and can't be used with `GET /v1/verify/{id}`. |
| `createdAt` | Unix time in milliseconds. |

### Errors

| Status | `error` | What you do |
|---|---|---|
| 400 | `Missing or invalid verification id` | Ids are 1 to 128 letters, digits, `_` or `-`. |
| 400 | `Invalid status. ...`, `Invalid type. ...`, `Invalid limit. ...`, `Invalid before. ...` | Use the values in the tables above. |
| 403 | `This API key can't call ...` | Give the key the scope named in the message. |
| 404 | `Verification not found` | The id is wrong or belongs to another organization. |

401, 429 and other errors are covered in [C1 Quick start](/help/c1).

## Common questions

### When is a check charged?

When it completes. A check held for review is charged when the review is decided. A failed check isn't charged, and each check is charged only once, even if it is retried.

### Do test keys use credits?

No. Checks started with a test key return a fixed sandbox result and cost nothing, so they never appear as deductions in the ledger.

### Why does the ledger show credits but my invoice shows money?

Sentinel counts in credits. Each ledger line also records its money value at the time it was written, so a later plan or price change never reprices history. The **Billing & Credits** page shows that value next to each line.

### Can I get a check from last year?

Yes, as long as your organization keeps it. After your retention period (7 years by default) personal data is removed, but the check still returns its id, type, verdict and dates.

### What happens when the balance runs out?

New checks are refused with status 402. Subscribe to the `sentinel.credits.low` webhook event to hear about it before then. See [C7 Webhooks](/help/c7) and [A2 Choosing a plan and paying](/help/a2).

## Related chapters

- [C1 Quick start](/help/c1)
- [C2 KYC API](/help/c2)
- [C3 Documents API](/help/c3)
- [C4 AML and monitoring API](/help/c4)
- [C7 Webhooks](/help/c7)
- [A2 Choosing a plan and paying](/help/a2)
- [A12 Usage and reports](/help/a12)
