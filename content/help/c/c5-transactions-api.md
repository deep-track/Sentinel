---
id: c5
title: Transactions API
summary: Send your customers' transactions to Sentinel in batches of up to 500, safely retry them, and read which rows were accepted or rejected.
roles: Developer, Admin
---

## What it's for

`POST /v1/transactions` feeds transaction monitoring from your core banking system, wallet or M-Pesa integration. Each transaction you send is stored, checked against the customer's history by the monitoring rules, and its counterparty (the person or business on the other side of the payment) is screened against sanctions and watch lists. When a rule is met, an alert appears on the **Transactions** page for your compliance team. The rules and how alerts are worked are in [B13 Transaction monitoring](/help/b13).

The API does the same job as the CSV upload on the **Transactions** page, with the same fields and the same checks. Use it to send transactions automatically, for example every few minutes or at the end of each day.

Transaction monitoring does not use credits.

Authentication, test mode, rate limits and the general error format are in [C1 Quick start](/help/c1).

## Who can use it

- Any system holding a valid API key for your organization with the **Manage AML monitoring** scope. The same scope covers the monitoring calls in [C4](/help/c4).
- An **Admin** or **Developer** creates keys and picks their scopes on the **API Keys** page.
- A key created before scopes existed can call every endpoint.
- The alerts your transactions raise are seen and decided in Sentinel, not through the API. See [B13](/help/b13) for who can close or escalate them.

## Step by step

All examples read the key from the `SENTINEL_API_KEY` environment variable, for example `gt_live_...`. Replace `<your-sentinel-host>` with the API host shown for your organization.

### Send a batch

1. Collect up to 500 transactions. They can belong to many customers.
2. Give each one an `externalId` that never changes, such as the M-Pesa receipt number or your core banking transaction id.
3. Set `customerRef`. Where you can, use the Sentinel reference (`ver_...`) of the customer's KYC or AML check. Sentinel then knows the customer's risk rating, applies stricter thresholds to high-risk customers, and links the alert to the check.
4. Send them in one request as `{ "transactions": [...] }`.

#### curl

```bash
curl -X POST "https://<your-sentinel-host>/v1/transactions" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "externalId": "SJK4H7QX2P",
        "customerRef": "CUST-2077",
        "occurredAt": "2026-10-16T09:30:00+03:00",
        "amount": 150000,
        "currency": "KES",
        "direction": "in",
        "channel": "mpesa",
        "counterpartyName": "Otieno Odhiambo",
        "counterpartyCountry": "KE",
        "counterpartyAccount": "254712345678",
        "narration": "Paybill 522522 deposit"
      },
      {
        "externalId": "FT26289KX01",
        "customerRef": "CUST-2077",
        "occurredAt": "2026-10-16T11:05:00+03:00",
        "amount": 140000,
        "direction": "out",
        "channel": "bank_transfer",
        "counterpartyName": "Amina Hassan"
      }
    ]
  }'
```

#### Node

```javascript
const transactions = [
  {
    externalId: "SJK4H7QX2P",
    customerRef: "CUST-2077",
    occurredAt: "2026-10-16T09:30:00+03:00",
    amount: 150000,
    currency: "KES",
    direction: "in",
    channel: "mpesa",
    counterpartyName: "Otieno Odhiambo",
    counterpartyCountry: "KE",
  },
];

const res = await fetch("https://<your-sentinel-host>/v1/transactions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ transactions }),
});
const result = await res.json();
console.log(res.status, result.accepted, result.duplicates, result.rejected);
```

#### Python

```python
import os
import requests

transactions = [
    {
        "externalId": "SJK4H7QX2P",
        "customerRef": "CUST-2077",
        "occurredAt": "2026-10-16T09:30:00+03:00",
        "amount": 150000,
        "currency": "KES",
        "direction": "in",
        "channel": "mpesa",
        "counterpartyName": "Otieno Odhiambo",
        "counterpartyCountry": "KE",
    },
]

res = requests.post(
    "https://<your-sentinel-host>/v1/transactions",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={"transactions": transactions},
)
result = res.json()
print(res.status_code, result["accepted"], result["duplicates"], result["rejected"])
```

### Send more than 500

Split the list into chunks of 500 and send them one after another. If a request fails part-way, for example on a timeout or a 429, send the same chunk again. Rows that were already stored are counted as `duplicates` and skipped.

#### curl

This splits a JSON array file into chunks of 500 with jq, then posts each one.

```bash
jq -c '[_nwise(500)][] | {transactions: .}' all-transactions.json | while read -r chunk; do
  curl -s -X POST "https://<your-sentinel-host>/v1/transactions" \
    -H "Authorization: Bearer $SENTINEL_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$chunk"
  echo
done
```

#### Node

```javascript
async function sendAll(all) {
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const res = await fetch("https://<your-sentinel-host>/v1/transactions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transactions: chunk }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? "1") * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait));
      i -= 500; // retry the same chunk
      continue;
    }
    const result = await res.json();
    for (const row of result.rejected) {
      console.warn(`row ${i + row.index} (${row.externalId}): ${row.error}`);
    }
  }
}
```

#### Python

```python
import time

def send_all(all_transactions):
    i = 0
    while i < len(all_transactions):
        chunk = all_transactions[i : i + 500]
        res = requests.post(
            "https://<your-sentinel-host>/v1/transactions",
            headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
            json={"transactions": chunk},
        )
        if res.status_code == 429:
            time.sleep(int(res.headers.get("Retry-After", "1")))
            continue  # retry the same chunk
        for row in res.json()["rejected"]:
            print(f"row {i + row['index']} ({row['externalId']}): {row['error']}")
        i += 500
```

### Check the outcome

1. Read `accepted`, `duplicates` and `rejected` in the response.
2. Fix each rejected row using its `error` and send those rows again. The `index` is the row's position in the array you sent, starting at 0.
3. Open **Transactions** in Sentinel. New alerts usually appear within a minute.

![Transactions page with alerts raised from API transactions](/help/shots/c5-alerts-from-api.png)

### Try it with a test key

Send the same request with a test key (`gt_test_...`). Sentinel checks every row and returns the same counts with `"sandbox": true`, but stores nothing and raises no alerts. Use it to check your field mapping before you go live.

## What each result means

### Transaction fields

| Field | Required | Rules |
|---|---|---|
| `externalId` | Yes | Your unique id for the transaction, as a string. Longer than 100 characters is cut to 100. |
| `customerRef` | Yes | Your customer id, or the Sentinel reference of the customer's KYC or AML check. Cut to 100 characters. |
| `occurredAt` | Yes | ISO 8601 date-time such as `2026-10-16T09:30:00+03:00`, or milliseconds since 1 January 1970. Not more than one day in the future, not before 2000. |
| `amount` | Yes | Positive number up to 1,000,000,000,000. A string such as `"150,000"` is also accepted. Rounded to 2 decimals. |
| `currency` | No | `KES` (default) or `USD`, any case. |
| `direction` | Yes | `in` or `out`, any case. |
| `channel` | No | `mpesa`, `cash`, `bank_transfer`, `rtgs`, `swift`, `card`, `cheque` or `other` (default). Any case; spaces and hyphens become underscores, and `M-Pesa` is read as `mpesa`. |
| `counterpartyName` | No | Who paid or was paid, cut to 200 characters. Needed for counterparty screening. |
| `counterpartyCountry` | No | 2-letter ISO code, for example `KE` or `AE`. |
| `counterpartyAccount` | No | Phone number, till, paybill or account number, cut to 100 characters. |
| `narration` | No | Your description, cut to 300 characters. |

Other fields in a transaction are ignored. Only `cash` counts as cash for the large cash rule. `cash` and `mpesa` both count for the structuring rule ([B13](/help/b13)).

### Response (202)

```json
{
  "accepted": 498,
  "duplicates": 1,
  "rejected": [
    { "index": 17, "externalId": "SJK4H7QX9Z", "error": "direction must be in or out" }
  ]
}
```

| Field | Meaning |
|---|---|
| `accepted` | Rows stored and sent to the rules. |
| `duplicates` | Rows whose `externalId` your organization already sent, by API or CSV, or that appear twice in this batch. They are skipped, not updated. |
| `rejected` | Rows that failed a check, each with `index`, `externalId` (or `null`) and `error`. |
| `sandbox` | Only with a test key: `true`. Nothing was stored, and `duplicates` is always 0. |

A 202 means the batch was read, even if some rows were rejected. Always check `rejected`.

### Row errors

| `error` | What to do |
|---|---|
| `externalId is required` | Send a non-empty string. A number is not accepted: send `"12345"`, not `12345`. |
| `customerRef is required` | Send a non-empty string. |
| `occurredAt must be an ISO date-time or epoch milliseconds, not in the future` | Check the format, the time zone and the year. |
| `amount must be a positive number` | Send a number above 0. |
| `currency must be KES or USD` | Convert other currencies before sending. |
| `direction must be in or out` | Map your debit and credit codes to `out` and `in`. |
| `channel must be one of mpesa, cash, bank_transfer, rtgs, swift, card, cheque, other` | Map your channel codes, or send `other`. |
| `counterpartyCountry must be a 2-letter ISO code` | Send `KE`, not `KEN` or `Kenya`. |
| `No USD to KES rate is set, so KES amounts can't be checked.` | Contact DeepTrack's review team to set the rate, then resend. Live keys only. |

### Request errors

| Status | Message | What to do |
|---|---|---|
| 400 | `Invalid JSON body` | Send valid JSON. |
| 400 | `Send { transactions: [...] } with 1 to 500 transactions.` with a `details` object | The body must be an object with a `transactions` array of 1 to 500 objects. |
| 403 | `This API key can't call POST /v1/transactions. ...` | Give the key the **Manage AML monitoring** scope. |
| 429 | `Rate limit exceeded` | Wait for the `Retry-After` seconds, then resend the same batch. |

## Common questions

### Is it safe to send the same batch twice?

Yes. Sentinel keeps one transaction per `externalId` in your organization, so a resend only increases `duplicates`. A resend can't change a stored transaction. To correct one, use a new `externalId`.

### Do test-key transactions show up in Sentinel?

No. A test key only checks the rows. Nothing is stored, no rules run and no counterparties are screened.

### How quickly are alerts raised?

The rules run straight after each batch, and new alerts usually appear on the **Transactions** page within a minute. Counterparties are screened 20 at a time, so a batch with many new names can take a few minutes. Each name's result is reused for 30 days.

### Can I read alerts or decisions through the API?

No. There is no API call or webhook for transaction alerts. Your team sees them on the **Transactions** page and gets a "Transaction alerts" notification by default ([B13](/help/b13)).

### Does sending transactions cost credits?

No. Transaction monitoring and counterparty screening are not charged.

### How long are transactions kept?

For your organization's retention period, at least seven years. An Admin sets it in **Settings** → **Audit & data**.

## Related chapters

- [C1 Quick start](/help/c1)
- [C4 AML and monitoring API](/help/c4)
- [C6 Results and credits](/help/c6)
- [B13 Transaction monitoring](/help/b13)
- [B14 Filing an STR or SAR](/help/b14)
- [A7 Screening rules](/help/a7)
