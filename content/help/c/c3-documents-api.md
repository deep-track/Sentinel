---
id: c3
title: Documents API
summary: Verify an identity document, proof of address or KRA PIN certificate with POST /v1/verify/document and match it against the customer's declared details.
roles: Developer, Admin
---

## What it's for

The Documents API checks one document on its own, without a selfie or liveness. It is the API version of the **Documents (IDP)** page (IDP: intelligent document processing). See [B5 Document checks](/help/b5).

You send one call to `POST /v1/verify/document` with a `documentKind`:

- `identity`: passport, national ID (including both Kenyan cards, the second-generation ID and the Maisha card), driver's licence or residence permit.
- `proof_of_address`: utility bill, bank statement, salary slip, rental agreement and over 20 other types.
- `kra_pin`: a Kenya Revenue Authority PIN certificate, for an individual or a company.

You can also send what the customer told you, such as their name, date of birth, address or KRA PIN, and Sentinel checks the document against it.

Each document goes through file forensics, an AI reading of the fields and visual fraud signs, an independent OCR (optical character recognition) reading, and rule checks. The call is asynchronous. It returns an `id` at once, and the result arrives by webhook or from `GET /v1/verify/{id}`.

Keys, test mode, rate limits and the general error format are in [C1 Quick start](/help/c1).

## Who can use it

- Any system holding an API key for your organization with the **Run IDP document checks** scope (`verify:document`). To read results by polling, the key also needs **Read check results**.
- **Admin** and **Developer** create keys and choose their scopes on the **API Keys** page.
- Everyone in your organization can open API checks on the **Documents (IDP)** page. Any document that doesn't pass opens a review case for your team. See [B11 Deciding a review case](/help/b11).

![API Keys page with a key that has the Run IDP document checks scope](/help/shots/c3-key-scope.png "TODO")

## Step by step

The examples read the key from the `SENTINEL_API_KEY` environment variable, for example `gt_test_...`. Replace `<your-sentinel-host>` with your organization's API host.

### Prepare the file

1. Use a JPEG, PNG, WebP or PDF. Sentinel reads the file type from its contents, not its name.
2. Send the original file where you can. Resizing or re-saving removes the hidden data that reveals AI-generated or edited files.
3. Base64-encode it. A `data:` prefix and line breaks are removed for you.
4. Keep each file to 1,000,000 base64 characters, about 730 KB.
5. For an identity card or licence, also send the back in `documentBackBase64`. The back of a Kenyan ID carries the MRZ (machine-readable zone: the coded lines that Sentinel checks digit by digit). Proof of address and KRA PIN certificates take one file only.

### Verify an identity document

#### curl

```bash
FRONT=$(base64 -w0 maisha-front.jpg)    # macOS: base64 -i maisha-front.jpg
BACK=$(base64 -w0 maisha-back.jpg)

curl -X POST "https://<your-sentinel-host>/v1/verify/document" \
  -H "Authorization: Bearer $SENTINEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "documentKind": "identity",
  "documentFrontBase64": "$FRONT",
  "documentBackBase64": "$BACK",
  "expectedName": "Amina Hassan Omar",
  "expectedDateOfBirth": "1990-07-23",
  "externalRef": "CUST-1001"
}
EOF
```

#### Node (built-in fetch, Node 18+)

```javascript
import { readFile } from "node:fs/promises";

const b64 = async (path) => (await readFile(path)).toString("base64");

const res = await fetch("https://<your-sentinel-host>/v1/verify/document", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENTINEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    documentKind: "identity",
    documentFrontBase64: await b64("maisha-front.jpg"),
    documentBackBase64: await b64("maisha-back.jpg"),
    expectedName: "Amina Hassan Omar",
    expectedDateOfBirth: "1990-07-23",
    externalRef: "CUST-1001",
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

res = requests.post(
    "https://<your-sentinel-host>/v1/verify/document",
    headers={"Authorization": f"Bearer {os.environ['SENTINEL_API_KEY']}"},
    json={
        "documentKind": "identity",
        "documentFrontBase64": b64("maisha-front.jpg"),
        "documentBackBase64": b64("maisha-back.jpg"),
        "expectedName": "Amina Hassan Omar",
        "expectedDateOfBirth": "1990-07-23",
        "externalRef": "CUST-1001",
    },
)
print(res.status_code, res.json())
```

### Verify a proof of address or KRA PIN certificate

The call is the same. Change `documentKind`, send one file, and use the matching fields. For a proof of address:

```json
{
  "documentKind": "proof_of_address",
  "documentFrontBase64": "<base64>",
  "expectedName": "Otieno Odhiambo",
  "expectedAddress": "Plot 12, Ngong Road, Nairobi",
  "maxDocumentAgeDays": 90
}
```

For a KRA PIN certificate:

```json
{
  "documentKind": "kra_pin",
  "documentFrontBase64": "<base64>",
  "expectedName": "Wanjiku Kamau",
  "expectedKraPin": "A012345678Z"
}
```

### Collect the result

1. Wait for the `sentinel.scan.complete` webhook with `product` `idp`. See [C7 Webhooks](/help/c7).
2. Or poll `GET /v1/verify/{id}` until `status` is `completed` or `failed`. A completed document check carries a `document` object, described below. See [C6 Results and credits](/help/c6).
3. Results usually take under a minute.

![Document report for Amina Hassan Omar's Maisha card, opened from an API check](/help/shots/c3-report.png "TODO")

## What each result means

### Request fields

| Field | Required | Applies to | Rules |
|---|---|---|---|
| `documentKind` | Yes | All | `identity`, `proof_of_address` or `kra_pin`. |
| `documentFrontBase64` | Yes | All | Base64 JPEG, PNG, WebP or PDF. |
| `documentBackBase64` | No | `identity` | The back of the card. Rejected for the other kinds. |
| `expectedName` | No | All | Matched against the holder, account holder or taxpayer name. |
| `expectedDateOfBirth` | No | `identity` | YYYY-MM-DD. Must match exactly. |
| `expectedAddress` | No | `proof_of_address` | The declared address. |
| `expectedKraPin` | No | `kra_pin` | A or P, nine digits, then a letter, for example A012345678Z. Spaces and lower case are tidied up. |
| `maxDocumentAgeDays` | No | `proof_of_address` | Whole number from 1 to 365. Without it, your organization's setting applies (90 days by default, changed in **Settings** → **Screening rules**). |
| `externalRef` | No | All | Your own reference, kept with the check. |

Text fields are at most 300 characters.

### Response to the POST (202)

| Field | What it holds |
|---|---|
| `id` | The check's id, `ver_` followed by 32 letters and digits. |
| `type` | Always `document`. |
| `status` | `queued` with a live key; `completed` with a test key. |
| `verdict`, `sandbox` | Test keys only: `pass` and `true`. |

### Verdicts

| Verdict | What it means | What to do |
|---|---|---|
| `pass` | No fraud signals and every check passed. | Accept the document. |
| `review` | At least one high or medium finding, such as a name mismatch or an old bill. A case is open. | Wait for your team's decision. |
| `reject` | At least one critical finding, such as an AI-generated image, a failed MRZ check digit or an expired document. A case is still opened at high priority. | Don't accept it. Ask for the original. |
| (status `failed`) | The file couldn't be processed. See `failureReason`. | Fix the file and send it again. You aren't charged. |

`confidence` is 1 minus `riskScore` / 100. Your Admin can send AI-generated or other fraud rejections to review instead, and can limit which proof of address types pass. See [B5 Document checks](/help/b5).

### The `document` object

| Field | What it holds |
|---|---|
| `reason` | One line, for example "Proof of address needs review: ...". |
| `riskScore` | 0 to 100. Each critical finding adds 60, high 30, medium 12, low 3. |
| `documentKind` | The kind you sent. |
| `identity` | `fields` (document type, number, names, dates, sex, nationality, `kenyanIdType`, `serialNumber`, `personalNumber` and more), `mrz`, `age`, `isAdult`, `isExpired`, `expectedNameMatch` (0 to 1), `expectedDateOfBirthMatch`. |
| `proofOfAddress` | `fields` (`documentType`, `issuerName`, `holderName`, `address`, `issueDate`, `accountReference`), `nameMatch`, `addressMatch`, `documentAgeDays`, `maxDocumentAgeDays`. |
| `kraPin` | `fields` (`pin`, `taxpayerName`, `taxpayerType`, `email`, `certificateDate`, `obligations`, `issuedByKra`), `nameMatch`, and `registry` with what KRA's own records say, when that lookup is available. |
| `checks` | Each check's `name` and `status`: `passed`, `failed` or `not_applicable`, with an optional `detail`. |
| `flags` | Each finding's `code`, `severity` (`critical`, `high`, `medium`, `low`), `source` (`file`, `mrz`, `rules`, `vision`, `ocr`) and `message`. |
| `ocr` | `status` (`checked`, `not_configured`, `unavailable`, `unsupported_file`), `checked` and `missing` values. WebP files skip this cross-check. |
| `forensics` | `fileTypes`, editing `software` found, and `metadataAvailable`. |

The objects that don't apply to the kind are `null`. A name matches at a score of 0.67 or more, an address at 0.6 or more.

### Common flag codes

| Code | Severity | Meaning |
|---|---|---|
| `visual_ai_generated`, `ai_generator_metadata` | critical (or high) | Signs the file was made by an AI image tool. |
| `mrz_check_digit_failed`, `mrz_mismatch` | critical | The MRZ is invalid or disagrees with the printed fields. |
| `document_expired` | critical | The expiry date has passed. |
| `kra_pin_format`, `not_a_kra_certificate` | critical | Not a valid KRA PIN, or not a KRA certificate. |
| `expected_name_mismatch`, `name_mismatch` | high | The name doesn't match `expectedName`. |
| `address_mismatch` | high | The address doesn't match `expectedAddress`. |
| `document_too_old` | high | The proof of address is older than `maxDocumentAgeDays`. |
| `kra_pin_not_registered` | high | KRA has no record of the PIN. |
| `visual_low_quality`, `visual_partial_or_cropped` | medium | The image is too poor to verify. |

### Errors specific to this call

| Status | `error` | What to do |
|---|---|---|
| `400` | "Invalid fields: documentKind" with `details` | Fix the named fields. |
| `400` | "This document type takes one file (documentFrontBase64)." | Drop `documentBackBase64`. |
| `400` | "expectedKraPin applies to KRA PIN certificates only.", "maxDocumentAgeDays applies to proof of address only." | Send the field with the right kind. |
| `400` | "Expected date of birth must be YYYY-MM-DD.", "maxDocumentAgeDays must be a whole number from 1 to 365." | Fix the value. |
| `413` | "documentFrontBase64 exceeds the 1000000-character limit. ..." | Compress or resize the file. |
| `402` | "Insufficient credits" | Top up. |

When processing fails, `failureReason` is one of: "The front of the document is not a JPEG, PNG, WebP or PDF file.", "The document could not be read. Try a clearer, uncropped image." or "Document verification is temporarily unavailable; please retry."

## Common questions

### How many credits does a document check cost?

On KES plans, an identity document or KRA PIN certificate costs 1 credit and a proof of address 2. On USD plans, identity and KRA cost 80 credits on Starter, 50 on Growth, 45 on Business and 30 on Enterprise; proof of address costs 110, 80, 70 and 65. A completed check is charged whatever the verdict. A failed check isn't.

### Does Sentinel keep the document image?

No. Sentinel reads the file and keeps only the extracted fields, checks and findings. Keep your own copy.

### What does a test key return?

`status` `completed`, `verdict` `pass` and `sandbox: true` at once, with no charge. The field rules above still apply, so a bad `expectedKraPin` still gets `400`.

### Does a minor's ID get rejected?

No. The `Age 18+` check shows whether the holder is an adult, but doesn't change the verdict. Read `identity.isAdult` if your product needs an adult.

### Can I send a PDF bank statement?

Yes. The independent OCR cross-check reads single-page PDFs, so where you can, send just the page with the name, address and date.

### Is a flag proof of fraud?

No. Flags are leads for a person to review. Check the original document before you act.

## Related chapters

- [C1 Quick start](/help/c1)
- [C2 KYC API](/help/c2)
- [C6 Results and credits](/help/c6)
- [C7 Webhooks](/help/c7)
- [B5 Document checks](/help/b5)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
