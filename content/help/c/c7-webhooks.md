---
id: c7
title: Webhooks
summary: Add a webhook endpoint, choose its events, check every delivery's signature, handle retries and rotate the signing secret without a gap.
roles: Admin, Developer
---

## What it's for

A webhook is a request Sentinel sends to your server when something happens, so you don't have to poll. Sentinel POSTs a signed JSON message to your endpoint when a check completes or fails, when ongoing AML monitoring finds a new hit, when a person decides a review case, and when your credits run low.

You can have up to 5 endpoints, for example one for production and one for staging. Each has its own URL, events, products, signing secret and custom headers.

For API keys, test mode and errors, see [C1 Quick start](/help/c1). To fetch a result yourself, see [C6 Results and credits](/help/c6).

## Who can use it

- Everyone in your organization can open the **Webhooks** page and read the delivery log.
- **Admin** and **Developer** can add, edit, test, pause, resume and delete endpoints, and rotate secrets.
- **Admin**, **Reviewer**, **Analyst** and **Developer** can resend deliveries. **Viewer / Auditor** can't.
- Webhooks don't use credits.

## Step by step

### Add an endpoint

1. In the sidebar, under **Developer**, click **Webhooks**. The same panel is also in **Settings** → **Developers**.
2. Click **Add endpoint**.
3. In **URL**, enter a public HTTPS address that accepts POST requests, for example `https://api.demobank.co.ke/sentinel/webhook`. Private addresses, plain `http` and URLs with a username or password are refused.
4. In **Description**, give it a name your team will recognise, for example "Production onboarding service".
5. Under **Events**, tick what this endpoint receives. **Check completed or failed** and **AML monitoring alert** are ticked by default.
6. Under **Products**, leave **Every product** ticked, or untick it and choose from **KYC (identity)**, **AML screening**, **Documents (IDP)**, **Business (KYB)** and **Liveness**.
7. In **Checks from**, choose **Live and test**, **Live only** or **Test keys only**. Send test-key results to a staging endpoint with **Test keys only**.
8. Under **Custom headers**, click **Add header** if your gateway expects a token, for example `Authorization`. You can add up to 5. Values are hidden after saving.
9. Click **Add endpoint**.
10. The **Signing secret** dialog shows the secret once. Copy it into your secrets manager, tick **I've stored this secret.** and click **Done**.

![Add endpoint dialog with events, products and Checks from](/help/shots/c7-add-endpoint.png)

### Check the signature

Every delivery carries these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Sentinel-Timestamp` | Unix time in seconds when the delivery was sent. |
| `X-Sentinel-Signature-V2` | Hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with the endpoint's secret. Verify this one. |
| `X-Sentinel-Signature-V2-Next` | The same, keyed with a new secret that is waiting to be activated. Only sent during a rotation. |
| `X-Sentinel-Signature` | Older scheme: hex HMAC-SHA256 of the raw body alone, with the current secret. Kept for existing integrations. It has no replay protection. |

To check a delivery:

1. Read the raw request body as bytes, before any JSON parsing.
2. Reject it if `X-Sentinel-Timestamp` is missing or more than 5 minutes from your clock.
3. Compute HMAC-SHA256 of the timestamp, a full stop and the raw body, with your secret, as lowercase hex.
4. Compare it in constant time with `X-Sentinel-Signature-V2`, and with `X-Sentinel-Signature-V2-Next` if present. Accept if either matches.
5. Return any 2xx status within 10 seconds. Do slow work after you respond.

#### Node

```javascript
// Node 18+, no dependencies. Save as receiver.mjs.
import crypto from "node:crypto";
import http from "node:http";

const SECRET = process.env.SENTINEL_WEBHOOK_SECRET;

function verify(rawBody, headers, secret) {
  const timestamp = headers["x-sentinel-timestamp"];
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay window
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex"),
  );
  return [headers["x-sentinel-signature-v2"], headers["x-sentinel-signature-v2-next"]]
    .filter((sig) => typeof sig === "string" && sig.length === expected.length)
    .some((sig) => crypto.timingSafeEqual(Buffer.from(sig), expected));
}

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    if (!verify(rawBody, req.headers, SECRET)) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200).end(); // answer first, then process
    const event = JSON.parse(rawBody.toString("utf8"));
    console.log(event.event, event.scan_id, event.status);
  });
}).listen(3000);
```

#### Python

```python
import hashlib
import hmac
import os
import time

SECRET = os.environ["SENTINEL_WEBHOOK_SECRET"]

def verify(raw_body: bytes, headers, secret: str = SECRET) -> bool:
    timestamp = headers.get("X-Sentinel-Timestamp", "")
    if not timestamp.isdigit():
        return False
    if abs(time.time() - int(timestamp)) > 300:  # replay window
        return False
    expected = hmac.new(
        secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256
    ).hexdigest()
    given = [headers.get("X-Sentinel-Signature-V2"), headers.get("X-Sentinel-Signature-V2-Next")]
    return any(sig and hmac.compare_digest(sig, expected) for sig in given)

# Flask: verify(request.get_data(), request.headers)
# Django: verify(request.body, request.headers)
```

#### curl

To test your receiver before Sentinel calls it, sign a sample body yourself and post it:

```bash
BODY='{"event":"sentinel.test","scan_id":"test_local","status":"PASS","timestamp":"2026-10-16T09:00:00.000Z","product":null,"result":{"test":true}}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SENTINEL_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -H "X-Sentinel-Timestamp: $TS" \
  -H "X-Sentinel-Signature-V2: $SIG" \
  -d "$BODY"
```

### Send a test event

1. On the endpoint's row, click **Send test**.
2. Wait for the line under the row. **Test delivered: HTTP 200 in ... ms.** means your receiver accepted it. **Test failed: ...** gives the reason.

A test event is sent once, is never retried and doesn't count towards pausing. Its `event` is `sentinel.test` and its `scan_id` starts with `test_`.

![Webhook endpoints with an active endpoint and a delivered test event](/help/shots/c7-endpoints.png "TODO")

### Read the delivery log

1. Find **Deliveries** under your endpoints. It lists the latest 100 deliveries.
2. Filter by **Scan ID**, by status, or by endpoint when you have more than one.
3. Click a row to open it. You see each attempt with its HTTP status and time, and the exact payload that was sent.
4. To send it again, click **Resend**. To resend every failed delivery for an endpoint, click **Resend N failed** on its row.

![Delivery details with three attempts and the payload](/help/shots/c7-delivery.png "TODO")

### Rotate the secret

1. On the endpoint's row, click **Rotate secret** and confirm.
2. Copy the new secret from the **Signing secret** dialog, tick **I've stored this secret.** and click **Done**.
3. Deploy the new secret to your receiver alongside the old one. Until it is activated, deliveries are still signed with the old secret in `X-Sentinel-Signature-V2`, and with the new one in `X-Sentinel-Signature-V2-Next`.
4. Click **Activate now**, or wait: the new secret takes over 24 hours after you rotated.
5. Remove the old secret from your receiver.

## What each result means

### Events

| Event | Label on screen | When it is sent |
|---|---|---|
| `sentinel.scan.complete` | **Check completed or failed** | A check finished or failed. Also sent again with the final verdict when a review is decided, unless the endpoint subscribes to `sentinel.review.decided`. |
| `sentinel.monitoring.alert` | **AML monitoring alert** | Ongoing monitoring found a new or more severe hit. |
| `sentinel.review.decided` | **Review decided** | A person approved or rejected a held case. |
| `sentinel.credits.low` | **Low credits** | Your balance fell to your warning level. |
| `sentinel.test` | Test event | You clicked **Send test**. Always sent. |

### Payload fields

| Field | What it holds |
|---|---|
| `event` | One of the events above. |
| `scan_id` | The check's `id`, for example `ver_3f9a1c0b7d2e4a51`. Use it with `GET /v1/verify/{id}`. |
| `status` | `PASS`, `REVIEW`, `REJECT` or `FAILED`. For low credits: `REJECT` when the balance is 0 or less, else `REVIEW`. |
| `timestamp` | ISO 8601 time the payload was built. |
| `product` | `kyc`, `aml`, `idp` (documents), `kyb` or `liveness`; `null` for test and low-credit events. |
| `result` | The check's full result. Its shape depends on the product (see [C2](/help/c2) to [C5](/help/c5)). For `FAILED`, `{ "failureReason": ... }`. |
| `review` | `sentinel.review.decided` only: `decision` (`approved` or `rejected`), `decided_by` (`client` or `deeptrack`), `reason`, `decided_at`. |
| `credits` | `sentinel.credits.low` only: `balance` and `warning_level`. |

### Delivery statuses

| Status | What it means | What you do |
|---|---|---|
| `pending` | Queued to send. | Nothing. |
| `delivered` | Your endpoint returned a 2xx. | Nothing. |
| `retrying` | The last attempt failed. The row shows when the next one is due. | Fix your endpoint. |
| `failed` | Every attempt failed, or the URL can't be used. | Fix it, then **Resend**. |
| `paused` | Held because the endpoint is paused. | **Resume** the endpoint. |

### Retries and pausing

A delivery fails when your endpoint returns anything other than 2xx, takes longer than 10 seconds, can't be reached, or redirects (Sentinel doesn't follow redirects). After a failure Sentinel tries again 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours later: 7 attempts in all. Then the delivery is `failed`. A URL that isn't a public HTTPS address isn't retried.

After 20 failed attempts in a row, the endpoint is paused, its queued deliveries are held, and Admins and Developers get a **Webhook paused** notification. Click **Resume** to send the held deliveries, oldest first.

## Common questions

### Can a delivery arrive twice?

Yes. A resend, or a review being decided, sends another delivery for the same check. Use `scan_id` and `event` to recognise one you have already handled, and fetch the check if you need its latest state.

### Can I allowlist Sentinel's IP addresses?

No. Deliveries don't come from fixed IP addresses, so trust the signature instead.

### Do test-key checks send webhooks?

Yes, to endpoints set to **Live and test** or **Test keys only**. The result says `sandbox: true`.

### Does Sentinel read my endpoint's response?

No. It records only the status code and how long the response took.

### Who hears about a paused endpoint?

Admins and Developers, in the app and by email, by default. An Admin can change this in **Settings** → **Notifications**. See [A9 Notifications](/help/a9).

## Related chapters

- [C1 Quick start](/help/c1)
- [C2 KYC API](/help/c2)
- [C4 AML and monitoring API](/help/c4)
- [C6 Results and credits](/help/c6)
- [A9 Notifications](/help/a9)
