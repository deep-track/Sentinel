---
id: c8
title: KYB and capture links API
summary: Verify a business with POST /v1/verify/kyb, and send customers a capture link with /v1/capture-links so they do their KYC on their own phone.
roles: Developer, Admin
---

## What it's for

This chapter covers two APIs that do from your own systems what the dashboard does on two of its pages.

- **KYB API** (`POST /v1/verify/kyb`). It does what the **Business checks (KYB)** page does. You send the business, its directors and owners, its registration certificate (or CR12) and a proof of address. Sentinel reads both documents, checks the Business Registration Service (BRS) register where it can, and screens the business and every person for sanctions, PEPs and adverse media. See [B8 Business checks (KYB)](/help/b8).
- **Capture links API** (`/v1/capture-links`). It does what the **Capture links** page does. You create a link, and Sentinel sends it by SMS or WhatsApp, or gives it back to you to share. The customer opens it on their phone, photographs their ID and takes a selfie. That becomes an ordinary KYC check. See [B3 Capture links: KYC on the customer's phone](/help/b3).

Both are asynchronous. A KYB check returns an `id` at once, and its result arrives by webhook or from `GET /v1/verify/{id}`. A capture link returns its own `id` (`cap_…`). Once the customer submits, the link names the KYC check it became.

Keys, test mode, rate limits and the general error format are in [C1 Quick start](/help/c1).

## Who can use it

- Any system holding an API key for your organization with the right scope:
  - **Run business (KYB) checks** (`verify:kyb`) for `POST /v1/verify/kyb`.
  - **Create and manage capture links** (`capture`) for every `/v1/capture-links` call.
  - **Read check results** (`results:read`) to read results by polling.
- **Admin** and **Developer** create keys and choose their scopes on the **API Keys** page. Keys made before scopes existed can call everything.
- Everyone in your organization sees API checks on the **Business checks (KYB)** page and API links on the **Capture links** page. A KYB check that doesn't pass opens a review case. See [B11 Deciding a review case](/help/b11).

## Step by step

The examples read the key from the `SENTINEL_API_KEY` environment variable. Replace `<your-sentinel-host>` with your organization's API host.

### Verify a business

1. Base64-encode the registration certificate (or CR12) and a proof of address in the business's name. Use a JPEG, PNG, WebP or PDF, of up to 4,000,000 base64 characters (about 3 MB) each.
2. List every director and owner, between 1 and 50 people. Give each person's ID number and date of birth: Sentinel screens each one and compares them with the BRS register.
3. Send the request.

#### curl

```bash
CERT=$(base64 -w0 cr12.pdf)     # macOS: base64 -i cr12.pdf
POA=$(base64 -w0 kplc-bill.pdf)

curl -X POST "https://<your-sentinel-host>/v1/verify/kyb" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "businessName": "Savanna Traders Limited",
  "registrationNumber": "PVT-AB1234",
  "incorporationCountry": "KE",
  "businessType": "Private limited company",
  "externalRef": "BIZ-2041",
  "registrationDocBase64": "$CERT",
  "proofOfAddressBase64": "$POA",
  "directors": [
    { "firstName": "Peter", "lastName": "Kamau", "email": "peter@savanna.example", "position": "Director", "shareholding": "60%", "dateOfBirth": "1985-03-07", "idNumber": "24567813" },
    { "firstName": "Amina", "lastName": "Omar", "email": "amina@savanna.example", "position": "Director", "shareholding": "40%", "dateOfBirth": "1990-07-23", "idNumber": "31122456" }
  ]
}
EOF
```

#### Node (built-in fetch, Node 18+)

```javascript
import { readFile } from "node:fs/promises";

const b64 = async (path) => (await readFile(path)).toString("base64");

const res = await fetch("https://<your-sentinel-host>/v1/verify/kyb", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    businessName: "Savanna Traders Limited",
    registrationNumber: "PVT-AB1234",
    incorporationCountry: "KE",
    registrationDocBase64: await b64("cr12.pdf"),
    proofOfAddressBase64: await b64("kplc-bill.pdf"),
    directors: [
      { firstName: "Peter", lastName: "Kamau", email: "peter@savanna.example", position: "Director", shareholding: "60%", dateOfBirth: "1985-03-07", idNumber: "24567813" },
    ],
  }),
});
console.log(res.status, await res.json()); // 202 { id: "ver_…", type: "kyb", status: "queued" }
```

#### Python (requests)

```python
import base64
import os
import requests

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

res = requests.post(
    "https://<your-sentinel-host>/v1/verify/kyb",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={
        "businessName": "Savanna Traders Limited",
        "registrationNumber": "PVT-AB1234",
        "incorporationCountry": "KE",
        "registrationDocBase64": b64("cr12.pdf"),
        "proofOfAddressBase64": b64("kplc-bill.pdf"),
        "directors": [
            {"firstName": "Peter", "lastName": "Kamau", "email": "peter@savanna.example", "position": "Director",
             "shareholding": "60%", "dateOfBirth": "1985-03-07", "idNumber": "24567813"},
        ],
    },
)
print(res.status_code, res.json())
```

4. Wait for the `sentinel.scan.complete` webhook (see [C7 Webhooks](/help/c7)), or poll `GET /v1/verify/{id}`.

### Send a capture link

1. Choose how the link reaches the customer, with `method`:
   - `sms` or `whatsapp`: Sentinel sends it to `contact`, a phone number in international format, such as `+254712345678`.
   - `link`: Sentinel only gives it back to you, for example to show in your app or send in your own email.
2. Choose the page's language with `language`: `en` for English or `sw` for Kiswahili.
3. Optionally, fill in what you already know in `prefill` (`firstName`, `lastName`, `idNumber`, `dateOfBirth`, `gender`). The customer then doesn't have to type it, and can't change it. Add `externalRef` with your customer ID.

```bash
curl -X POST "https://<your-sentinel-host>/v1/capture-links" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "sms",
    "contact": "+254712345678",
    "language": "sw",
    "prefill": { "firstName": "Wanjiku", "lastName": "Mwangi", "idNumber": "30458812" },
    "externalRef": "CUST-1001"
  }'
```

The answer is `201` with the link's details. The `link` field holds the customer's address, and it is shown only in this answer. Keep it if you'll send it yourself.

```json
{
  "id": "cap_8Fq2kT0aZx91LmPw",
  "link": "https://sentinel.deeptrack.io/verify/…",
  "method": "sms",
  "contact": "+254712345678",
  "language": "sw",
  "externalRef": "CUST-1001",
  "status": "pending",
  "delivery": "pending",
  "expiresAt": 1792396800000,
  "verificationId": null
}
```

### Follow a link and cancel it

- **One link:** `GET /v1/capture-links/{id}`. When `status` is `submitted`, `verificationId` is the KYC check it became. Read the check with `GET /v1/verify/{verificationId}`, or wait for its webhook.
- **All links, newest first:** `GET /v1/capture-links?limit=50`. To get the next page, pass `before=` with the `nextCursor` from the previous answer.
- **Cancel a link:** `DELETE /v1/capture-links/{id}`. A pending or opened link stops working, and its prefilled details are removed. A link that has been submitted or has expired stays as it is.

```bash
curl "https://<your-sentinel-host>/v1/capture-links/cap_8Fq2kT0aZx91LmPw" \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

## What each result means

### A KYB check (`GET /v1/verify/{id}`)

The verdict works as on the KYB page: `pass`, `review` (a person needs to look) or `reject`. A finished check also carries a `kyb` object:

| Field | What it holds |
|---|---|
| `reason` | Why Sentinel decided as it did, in one or two sentences. |
| `certificate` | The registration certificate's `verdict` and `reason`, such as a name or number that doesn't match. |
| `proofOfAddress` | The same for the proof of address. |
| `registry` | The BRS register lookup's `status`, when one ran. |
| `parties` | The business and each person: `name`, `role`, `verdict`, `reason` and the number of screening `hits`. |

The full report, with the documents, ownership and any owners the register shows but you didn't declare, is on the check's page in the dashboard.

### A capture link

| `status` | Meaning |
|---|---|
| `pending` | Created; the customer hasn't opened it. |
| `opened` | The customer opened the page but hasn't submitted. |
| `submitted` | The customer submitted; `verificationId` is their KYC check. |
| `expired` | 72 hours passed without a submission. |
| `cancelled` | You or a colleague cancelled it. |

`delivery` is `not_sent` for `link`, and `pending`, `sent` or `failed` for SMS and WhatsApp. When it's `failed`, `deliveryFailure` says why.

### Test keys

- A KYB check with a test key comes back at once as `completed` and `pass`, with `sandbox: true`. Nothing is checked or charged, and the files are deleted.
- A capture link with a test key comes back with `sandbox: true` and `link: null`. Nothing is stored or sent.

### Errors

| Status | When |
|---|---|
| `400` | A required field is missing or invalid; `details` lists what each field takes. |
| `402` | Not enough credits for a KYB check. |
| `403` | The key lacks the scope, the IP address isn't allowed, or the account isn't active. |
| `404` | No capture link with that `id` in your organization. |
| `413` | A KYB file is over 4,000,000 base64 characters. |
| `429` | Too many requests or links. A phone number gets at most 3 links an hour. |

## Common questions

### When is a KYB check charged?

When it finishes, at the KYB price on your plan, as on the dashboard. A request refused with `400`, `402` or `403` costs nothing, and its files are deleted.

### When is a capture link charged?

The link is free. The KYC check is charged when the customer submits, at the KYC price.

### How long does Sentinel keep KYB documents sent through the API?

For your data retention period, like the rest of the check. They are deleted when the check is purged. See [A11 Data retention and data requests](/help/a11).

### Can I send the KYB documents as links instead of files?

Not through the API. Send the files themselves; Sentinel doesn't download documents from your servers.

### Why doesn't the customer receive the SMS?

Check `delivery` and `deliveryFailure` on the link. If messaging isn't set up for your organization yet, use `method: "link"` and send the link yourself.

## Related chapters

- [C1 Quick start](/help/c1)
- [C2 KYC API](/help/c2)
- [C6 Results and credits](/help/c6)
- [C7 Webhooks](/help/c7)
- [B3 Capture links: KYC on the customer's phone](/help/b3)
- [B8 Business checks (KYB)](/help/b8)
