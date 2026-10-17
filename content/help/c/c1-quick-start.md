---
id: c1
title: Quick start
summary: Create an API key with the right scopes, try it in test mode, and run your first AML screening over the Sentinel API.
roles: Admin, Developer
---

## What it's for

The Sentinel API lets your own systems run checks without anyone opening the dashboard. Your core banking or onboarding app sends a request, and Sentinel returns a reference you use to fetch the result.

This chapter covers what every integration needs first: API keys and their scopes, test mode, the IP allowlist, rate limits and error responses. It ends with your first call, an AML screening (AML: anti-money laundering, here a check of a name against sanctions, PEP and watch lists).

Every request goes to your Sentinel API host, written in this manual as `https://<your-sentinel-host>`. DeepTrack gives you this address when your organization is set up. All paths start with `/v1/`.

## Who can use it

- **Admin** and **Developer** can create, edit, rotate and revoke API keys.
- **Reviewer**, **Analyst** and **Viewer / Auditor** can see the keys by prefix only. The page tells them "Only Admins and Developers can create, rotate or revoke keys."
- Only an **Admin** can change the IP allowlist in **Settings** → **Security**. See [A6 Security and single sign-on](/help/a6).
- Your code acts as your organization, not as a person. A key can do whatever its scopes allow, whoever created it.

## Step by step

### Create a test key

1. Click **API Keys** in the sidebar, under **Developer**. The same panel is in **Settings** → **Developers**.
2. Click **New key**.
3. In **Name**, describe the integration, for example "Core banking onboarding". Names are up to 60 characters.
4. Under **Environment**, choose **Test** ("Sandbox results, no charges.") or **Live** ("Real checks, billed."). New keys start on **Test**.
5. Under **Scopes**, leave **Everything** ticked, or untick it and choose only what this integration needs. For your first call, **Run AML screenings** and **Read check results** are enough.
6. Click **Create key**.
7. The **Your new API key** box shows the full key once. Copy it into your secrets manager, tick **I've copied and stored this key.**, then click **Done**. Sentinel stores only a hash of the key, so nobody can show it to you again.

![New API key dialog with a test key and two scopes chosen](/help/shots/c1-new-key.png)

Keys look like `gt_test_` or `gt_live_`, followed by two blocks of letters and digits. The table shows each key by its prefix, its scopes, when it was created and last used, and its status.

![API keys table with one active test key](/help/shots/c1-keys-table.png "TODO")

### Store the key in your environment

Keep the key out of your code. The examples below read it from an environment variable called `SENTINEL_API_KEY`.

```bash
export SENTINEL_API_KEY="gt_test_..."
```

Every request sends it as a bearer token: `Authorization: Bearer <your key>`. Request bodies are JSON, so also send `Content-Type: application/json`.

### Run your first AML screening

`POST /v1/verify/aml` needs the **Run AML screenings** scope. Only `subjectName` and `entityType` (`individual` or `entity`) are required. [C4 AML and monitoring API](/help/c4) lists the optional fields.

#### curl

```bash
curl -X POST "https://<your-sentinel-host>/v1/verify/aml" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subjectName": "Wanjiku Mwangi", "entityType": "individual", "country": "KE"}'
```

#### Node (built-in fetch, Node 18+)

```javascript
const res = await fetch("https://<your-sentinel-host>/v1/verify/aml", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ subjectName: "Wanjiku Mwangi", entityType: "individual", country: "KE" }),
});
const check = await res.json();
console.log(res.status, check);
```

#### Python (requests)

```python
import os
import requests

res = requests.post(
    "https://<your-sentinel-host>/v1/verify/aml",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={"subjectName": "Wanjiku Mwangi", "entityType": "individual", "country": "KE"},
)
print(res.status_code, res.json())
```

A successful call returns `202`. With a test key the check is already finished:

```json
{ "id": "ver_3f9c2a7e5b1d4c608e2f7a9b1c3d5e7f", "type": "aml", "status": "completed", "verdict": "pass", "sandbox": true, "monitoringId": null }
```

With a live key, `status` is `queued` and there is no `verdict` yet. Keep the `id`.

### Fetch the result

`GET /v1/verify/{id}` needs the **Read check results** scope. You can poll it, or let Sentinel call you when the check finishes. See [C7 Webhooks](/help/c7).

#### curl

```bash
curl "https://<your-sentinel-host>/v1/verify/ver_3f9c2a7e5b1d4c608e2f7a9b1c3d5e7f" \
  -H "Authorization: Bearer $SENTINEL_API_KEY"
```

#### Node (built-in fetch, Node 18+)

```javascript
const id = "ver_3f9c2a7e5b1d4c608e2f7a9b1c3d5e7f";
const res = await fetch(`https://<your-sentinel-host>/v1/verify/${id}`, {
  headers: { Authorization: `Bearer ${process.env.SENTINEL_API_KEY}` },
});
console.log(res.status, await res.json());
```

#### Python (requests)

```python
import os
import requests

check_id = "ver_3f9c2a7e5b1d4c608e2f7a9b1c3d5e7f"
res = requests.get(
    f"https://<your-sentinel-host>/v1/verify/{check_id}",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
)
print(res.status_code, res.json())
```

A completed AML check includes a `screening` object with the reason, the sources screened and any matches. [C6 Results and credits](/help/c6) explains every field.

### Rotate or revoke a key

1. On **API Keys**, find the key and click **Rotate**. You get a new key straight away, with the same name, environment and scopes. The old key keeps working for 24 hours, so deploy the new one first.
2. To stop a key at once, click **Revoke**. Requests with it fail immediately.
3. To change a key's name or scopes, click the pencil button. Scope changes apply to the next request.

### Limit API calls to your servers (optional)

1. An Admin opens **Settings** → **Security** → **IP allowlist** and adds your servers' outbound addresses, one IPv4 or IPv6 address or CIDR range per line.
2. Turn on **Apply to API requests too**, then save. Calls from any other address now get `403`.

## What each result means

### Scopes

| Scope | On screen | Lets the key call |
|---|---|---|
| `verify:kyc` | Run KYC identity checks | `POST /v1/verify/idp` |
| `verify:aml` | Run AML screenings | `POST /v1/verify/aml` |
| `verify:document` | Run IDP document checks | `POST /v1/verify/document` |
| `monitoring` | Manage AML monitoring | `/v1/monitoring/subjects` and `POST /v1/transactions` |
| `results:read` | Read check results | `GET /v1/verify` and `GET /v1/verify/{id}` |
| `credits:read` | Read credits and usage | `GET /v1/credits` and `GET /v1/credits/ledger` |

A key with **Everything** can call every route. Note that `POST /v1/transactions` needs **Manage AML monitoring**.

### Test mode

| Area | Test key (`gt_test_`) | Live key (`gt_live_`) |
|---|---|---|
| KYC, AML and document checks | Returns `status` `completed`, `verdict` `pass` and `sandbox: true` at once. No lists are screened and no document or face is processed. | Real check, starts `queued`. |
| Credits | Never charged. Works with a zero balance. | Charged per check. `402` if the balance is too low. |
| What is kept | A sandbox record with its `id`, which `GET /v1/verify` returns with `sandbox: true`. The names, ID numbers and images you sent are not stored. | The full check, under your retention period. |
| `monitor: true` on AML | Ignored. `monitoringId` is always `null`. | Enrols the subject in ongoing monitoring. |
| `POST /v1/transactions` | Validates the batch and stores nothing. The response has `sandbox: true`. | Stores and checks the transactions. |
| Webhooks | Sent to endpoints set to **Live and test** or **Test keys only**. | Sent to **Live and test** or **Live only** endpoints. |
| Validation, scopes, IP allowlist, rate limits | The same as live. | |

### Rate limits

Each key has a per-minute limit set by your plan. The burst is how many requests it can send at once before the per-minute rate applies.

| Plan | Requests per minute, per key | Burst |
|---|---|---|
| Trial | 10 | 10 |
| Starter | 60 | 10 |
| Growth | 200 | 30 |
| Business | 500 | 60 |
| Enterprise | 1,000 | 100 |

Your organization also has a per-minute cap across all its keys, agreed with DeepTrack (30 on a new trial). Separately, an address that sends 20 failed authentications in a minute is blocked for a short time. When any limit is hit you get `429` with a `Retry-After` header in seconds.

### Status codes and errors

Errors are JSON with an `error` message. Validation errors also include `details`, which describes each field.

| Status | `error` (examples) | What to do |
|---|---|---|
| `200` / `202` | (none) | `202` means the check was accepted. |
| `400` | "Invalid JSON body", "Missing required fields: subjectName", "Invalid fields: entityType" | Fix the request using `details`. |
| `401` | "Missing or malformed Authorization header", "Invalid API key" | Check the header. An unknown, revoked or expired rotated key all give "Invalid API key". |
| `402` | "Insufficient credits" | Top up. See [C6 Results and credits](/help/c6). |
| `403` | "This API key can't call POST /v1/verify/aml. Give it the "verify:aml" scope or use another key." | Add the scope or use another key. |
| `403` | "Requests from this IP address aren't allowed for your organization." | Add the server's address to the allowlist. |
| `403` | "Account is suspended", "Account is not active" | Contact DeepTrack. |
| `404` | "Verification not found" | Check the `id`. You can only read your own organization's checks. |
| `413` | "Media too large ..." | Send smaller images. See [C2 KYC API](/help/c2). |
| `429` | "Rate limit exceeded" | Wait for `Retry-After` seconds, then retry. |
| `500` | (server error) | Retry later with backoff. |

## Common questions

### Does test mode cost anything?

No. Test keys are never charged, and they work even when your balance is zero.

### Is my test data kept?

The names, ID numbers and images you send with a test key are not stored. Sentinel keeps a small sandbox record with the check's `id`, so you can test fetching results and webhooks.

### Can one key work in both test and live?

No. You choose the environment when you create the key, and it can't be changed. Create one key of each.

### I lost a key. Can you show it again?

No. Only a hash is stored. Rotate the key, or create a new one and revoke the old one.

### Why did a working key suddenly return 401?

It was revoked, or it was rotated more than 24 hours ago. Check its status on **API Keys**.

### How do I see my credit balance and prices from code?

Call `GET /v1/credits` with a key that has **Read credits and usage**. See [C6 Results and credits](/help/c6).

## Related chapters

- [C2 KYC API](/help/c2)
- [C3 Documents API](/help/c3)
- [C4 AML and monitoring API](/help/c4)
- [C5 Transactions API](/help/c5)
- [C6 Results and credits](/help/c6)
- [C7 Webhooks](/help/c7)
- [A5 Team members and roles](/help/a5)
- [A6 Security and single sign-on](/help/a6)
