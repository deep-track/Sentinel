---
id: c2
title: KYC API
summary: Send an ID image, a liveness capture and the customer's details to POST /v1/verify/idp, and read the verdict and each step's result.
roles: Developer, Admin
---

## What it's for

The KYC API runs a full KYC identity check (KYC: know your customer, confirming a customer is who they say they are) from your own onboarding app. You send one call to `POST /v1/verify/idp` with:

- the ID document image, front and, for cards, back
- a liveness capture: short video or camera frames that show a real person was in front of the camera
- the customer's ID number, names, date of birth and gender

Sentinel runs the same steps as a check started in the dashboard: document authenticity, liveness, IPRS (Kenya's national population register), AML screening and face match. See [B2 KYC identity checks](/help/b2). There is one difference. The API always takes a liveness capture, so a check sent through the API is the only kind that can be approved automatically. Checks from **New Verification** or a capture link always end in review.

The call is asynchronous. It returns an `id` at once, and the result arrives by webhook or from `GET /v1/verify/{id}`.

Keys, test mode, rate limits and the general error format are in [C1 Quick start](/help/c1).

## Who can use it

- Any system holding an API key for your organization with the **Run KYC identity checks** scope (`verify:kyc`). To read results by polling, the key also needs **Read check results**.
- **Admin** and **Developer** create keys and choose their scopes on the **API Keys** page.
- Everyone in your organization can see API checks on the **Identity (KYC)** page. Your team decides checks held for review in **Reviews**. See [B11 Deciding a review case](/help/b11).

![API Keys page with a key that has the Run KYC identity checks scope](/help/shots/c2-key-scope.png "TODO")

## Step by step

The examples read the key from the `SENTINEL_API_KEY` environment variable, for example `gt_test_...`. Replace `<your-sentinel-host>` with your organization's API host.

### Prepare the media

1. **ID image**: a JPEG or PNG of the document. Send the front in `documentFrontBase64`. For an ID card or driving licence, send the back in `documentBackBase64`.
2. **Liveness capture**: either an MP4 video (`livenessMediaType: "mp4"`), or JPEG frames (`livenessMediaType: "jpeg_frames"`). For frames, join one or more JPEG files byte for byte, then base64-encode the result as one string.
3. Encode each file as plain base64, without a `data:` prefix. Each media field can be at most 1,000,000 base64 characters, about 730 KB of file. Resize or compress larger images first.

Use JPEG frames where you can. Face match compares the first JPEG frame with the ID photo. With an MP4 capture, face match doesn't run.

### Send the check

#### curl

```bash
FRONT=$(base64 -w0 id-front.jpg)    # macOS: base64 -i id-front.jpg
BACK=$(base64 -w0 id-back.jpg)
FRAMES=$(cat frame1.jpg frame2.jpg frame3.jpg | base64 -w0)

curl -X POST "https://<your-sentinel-host>/v1/verify/idp" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "documentFrontBase64": "$FRONT",
  "documentBackBase64": "$BACK",
  "livenessFramesBase64": "$FRAMES",
  "livenessMediaType": "jpeg_frames",
  "idNumber": "30458812",
  "firstName": "Wanjiku",
  "lastName": "Mwangi",
  "dateOfBirth": "1992-04-11",
  "gender": "female"
}
EOF
```

#### Node (built-in fetch, Node 18+)

```javascript
import { readFile } from "node:fs/promises";

const b64 = async (path) => (await readFile(path)).toString("base64");
const frames = await Promise.all(["frame1.jpg", "frame2.jpg", "frame3.jpg"].map((p) => readFile(p)));

const res = await fetch("https://<your-sentinel-host>/v1/verify/idp", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    documentFrontBase64: await b64("id-front.jpg"),
    documentBackBase64: await b64("id-back.jpg"),
    livenessFramesBase64: Buffer.concat(frames).toString("base64"),
    livenessMediaType: "jpeg_frames",
    idNumber: "30458812",
    firstName: "Wanjiku",
    lastName: "Mwangi",
    dateOfBirth: "1992-04-11",
    gender: "female",
  }),
});
const check = await res.json();
console.log(res.status, check.id);
```

#### Python (requests)

```python
import base64
import os
import requests

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

frames = b"".join(open(p, "rb").read() for p in ["frame1.jpg", "frame2.jpg", "frame3.jpg"])

res = requests.post(
    "https://<your-sentinel-host>/v1/verify/idp",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={
        "documentFrontBase64": b64("id-front.jpg"),
        "documentBackBase64": b64("id-back.jpg"),
        "livenessFramesBase64": base64.b64encode(frames).decode(),
        "livenessMediaType": "jpeg_frames",
        "idNumber": "30458812",
        "firstName": "Wanjiku",
        "lastName": "Mwangi",
        "dateOfBirth": "1992-04-11",
        "gender": "female",
    },
)
print(res.status_code, res.json())
```

A live key returns `202` with `status` `queued`. Keep the `id`.

### Collect the result

1. Wait for the `sentinel.scan.complete` webhook with `product` `kyc`. Its `result` holds every step's output. See [C7 Webhooks](/help/c7).
2. Or poll `GET /v1/verify/{id}` until `status` is `completed` or `failed`. This returns the `verdict` but not the step details. See [C6 Results and credits](/help/c6).
3. If the verdict is `review`, your team decides the case in **Reviews**. You then get `sentinel.review.decided`, or a second `sentinel.scan.complete` with the final verdict.

![Webhook delivery log showing a KYC result for Wanjiku Mwangi](/help/shots/c2-webhook-log.png "TODO")

## What each result means

### Request fields

| Field | Required | Rules |
|---|---|---|
| `documentFrontBase64` | Yes | Base64 JPEG or PNG of the ID front. |
| `documentBackBase64` | No | Base64 of the back. Send it for ID cards and licences. |
| `livenessFramesBase64` | Yes | Base64 liveness capture. |
| `livenessMediaType` | Yes | `jpeg_frames` or `mp4`. |
| `idNumber`, `firstName`, `lastName`, `dateOfBirth`, `gender` | Yes | Strings of at most 200 characters, as printed on the ID. They are checked against IPRS. |

Each media field is at most 1,000,000 base64 characters. The API doesn't check the format of the text fields. Send the date of birth as YYYY-MM-DD.

### Response to the POST (202)

| Field | What it holds |
|---|---|
| `id` | The check's id, `ver_` followed by 32 letters and digits. |
| `type` | Always `idp`. |
| `status` | `queued` with a live key; `completed` with a test key. |
| `verdict`, `sandbox` | Test keys only: `pass` and `true`. |

### Verdicts

| Verdict | What it means | What to do |
|---|---|---|
| `pass` | Document, liveness, IPRS and AML all clear, and face match found no problem. `confidence` is `1`. | Onboard under your policy. |
| `review` | A step was unclear or a provider was unavailable. A review case is open. `confidence` is `null`. | Wait for your team's decision. |
| `reject` | A clear failure. `confidence` is `0`. | Don't onboard on this check. |
| (status `failed`) | Processing broke. `failureReason` is "Verification processing failed. Please retry or contact support." | Send the check again. You aren't charged. |

### The steps in `result`

Liveness and the document scan run first. If either needs review, IPRS and AML don't run and are missing from `result`.

| Key | Holds | Decides |
|---|---|---|
| `liveness` | `livenessScore` (0 to 1), `deepfakeFlag`, `confidence` | Passes at 0.85 or more with no deepfake. Otherwise review. |
| `docScan` | `fakeScore` (0 to 1), `flags`, `documentType` | Passes at 0.25 or less with no flags. Otherwise review. |
| `iprs` | `status` | `MATCH` continues. `PARTIAL_MATCH`, `NO_MATCH` or `TIMEOUT`: review. `INVALID` (bad ID format) or `REVOKED` (reported lost or stolen): reject. |
| `aml` | `status`, `matches` (`source`, `program`, `matchScore` 0 to 100, `matchedCountry`) | `SANCTIONS_HIT`: reject. `PEP`, `ADVERSE_MEDIA`, or any match scoring 60 or more: review. `CLEAR`: pass. |
| `faceMatch` | `status`, `outcome`, `similarity`, `message`, `duplicates` | `match` (90 or more) changes nothing. `uncertain`, `mismatch`, no face found, or the same face under another identity: review. Never rejects. `skipped` or `not_configured` has no effect. |
| `fraudNetwork` | Present when the ID number was seen with another person or in a fraud rejection. | Turns a pass into review. See [B10 Fraud signals explained](/help/b10). |

A step that couldn't reach its provider shows `"error": "provider_error"`, and the check goes to review.

### Errors specific to this call

| Status | `error` | What to do |
|---|---|---|
| `400` | "Missing required fields: livenessFramesBase64, ..." | Send every required field, not blank. |
| `400` | "Invalid fields: ..." with `details` | Text over 200 characters, media not a string, or a wrong `livenessMediaType`. |
| `413` | "Media too large (max 1000000 base64 characters each): documentFrontBase64" | Compress or resize the named file. |
| `402` | "Insufficient credits" | Top up. |

Other errors are in [C1 Quick start](/help/c1).

## Common questions

### How many credits does a KYC check cost?

1 credit on KES plans. On USD plans it is 130 credits on Starter and Trial, 75 on Growth, 63 on Business and 45 on Enterprise. The AML step is included. A pass or reject is charged when it completes, a review when your team decides it, and a failed check isn't charged.

### Can I send a selfie instead of a liveness capture?

No. The API has no selfie field, and the liveness fields are required. A still photo can't prove the person was present. For a selfie-only flow, use the dashboard or a capture link, which end in review. See [B3 Capture links](/help/b3).

### Does Sentinel keep the images?

No. The images go to the checks and are not stored with the check. Sentinel keeps the names, ID number, date of birth, gender and the step results for your retention period, 7 years by default.

### What does a test key return?

`status` `completed`, `verdict` `pass` and `sandbox: true` at once, with no providers called and no charge. The request is still validated, so a missing field or an oversized image still fails.

### Why is there no reason text for a KYC result?

`GET /v1/verify/{id}` returns only the verdict for KYC checks. Read the step results in the webhook's `result`, or open the report on the **Identity (KYC)** page.

### How long does a check take?

Usually a few minutes. A provider timeout sends the check to review rather than leaving it waiting.

## Related chapters

- [C1 Quick start](/help/c1)
- [C3 Documents API](/help/c3)
- [C4 AML and monitoring API](/help/c4)
- [C6 Results and credits](/help/c6)
- [C7 Webhooks](/help/c7)
- [B2 KYC identity checks](/help/b2)
- [B10 Fraud signals explained](/help/b10)
