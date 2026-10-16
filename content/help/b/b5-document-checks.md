---
id: b5
title: Document checks
summary: Check an ID, Maisha card, proof of address or KRA PIN certificate on the Documents (IDP) page, and read the document report and its fraud findings.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

The **Documents (IDP)** page checks a single document on its own, without a selfie or liveness. IDP stands for intelligent document processing. Use it when you already have the customer's document and want to know whether it is genuine, readable and in date.

Sentinel checks three kinds of document:

- **Identity document**: passport, national ID, driver's licence or residence permit. This includes both Kenyan national ID cards: the older second-generation card and the Maisha card.
- **Proof of address**: utility bill, bank statement, salary slip, rental agreement and over 20 other types.
- **KRA PIN certificate**: the Kenya Revenue Authority PIN certificate, for an individual or a company.

Each document goes through four layers. File forensics reads the file's hidden data for signs of AI image generators and editing software. An AI reading pulls out the printed fields and looks for visual fraud. A second, independent OCR (optical character recognition) reading confirms the key values. Then the rule checks run: dates, age, the MRZ (machine-readable zone, the coded lines at the bottom of a passport or ID card) and matching against what the customer told you.

## Who can use it

- **Admin**, **Analyst**, **Reviewer** and **Developer** can submit documents and open reports.
- **Viewer / Auditor** can open the page and every report, but can't submit. The form is replaced by the note "Your role can view document verifications but not submit new ones."
- When a document doesn't pass, Sentinel opens a review case. Who can decide it is set in **Settings** → **Review workflow**. See [B11 Deciding a review case](/help/b11).
- An Admin can change how fraud findings are handled in **Settings** → **Screening rules** → **Documents (IDP)**. See "What each result means" below.

## Step by step

### Submit a document

1. Click **Documents (IDP)** in the sidebar.
2. Choose the document type: **Identity document**, **Proof of address** or **KRA PIN certificate**.
3. Upload the file. For an identity document, use **Front of the document**, and add **Back of the document** for ID cards and licences. The back of a Kenyan ID carries the MRZ, so always add it. For the other two types, use **Document**.
4. Fill in what you want the document matched against. Every field is optional:
   - Identity document: **Expected name** and **Expected date of birth** (YYYY-MM-DD).
   - Proof of address: **Customer name**, **Declared address** and **Maximum document age (days)**. The age limit starts at 90 days and can be from 1 to 365.
   - KRA PIN certificate: **Taxpayer name** and **Declared KRA PIN**, for example A012345678Z.
5. Add **Your reference** if you want your own customer number on the report, for example CUST-1001.
6. Click **Verify document**. The page says "Verification queued. Results usually take under a minute."

![Documents (IDP) page with the identity document form](/help/shots/b5-idp-form.png "TODO")

Files can be JPG, PNG, WebP or PDF. Upload the original file where you can. An image larger than about 730 KB is resized before upload, and resizing removes the hidden data that reveals AI-generated or edited files. The page tells you when this happens. A PDF larger than 730 KB can't be shrunk, so upload a photo of the page instead.

### Open the report

1. Find the document under **Recent documents**. Each row shows the name read from the document, the type, the date and the number of flags.
2. Click the result button on the right, for example **Verified · View report**.
3. Read the header: the verdict, the fraud risk score out of 100 and a one-line reason.
4. Read the deepfake shield panel. It answers three questions: is the document AI-generated, has it been edited, and has the holder photo been replaced.
5. Work down the sections, from **Checks** and **Fraud and authenticity findings** to **How this document was checked**.
6. Click **Download report (PDF)** to keep a copy, or **Evidence (JSON)** for the raw result.

![Document report for Amina Hassan Omar's Maisha card, verified](/help/shots/b5-report-maisha.png "TODO")

### Kenyan ID cards

Sentinel tells the two Kenyan cards apart and shows the type in the **Kenyan ID card** row.

- **Second-generation ID**: the green and white card issued until 2023. It has no expiry date, so Sentinel doesn't flag a missing one. The **Serial number** row shows the card serial. The MRZ on the back may carry the serial number instead of the ID number, and Sentinel accepts either. In the demo, Peter Njoroge Kamau's card is an example.
- **Maisha card**: issued from 2023. It has an expiry date. The **Personal number** row shows the Maisha Namba where it is printed. In the demo, Amina Hassan Omar's card is an example.

For both cards, the ID number must be 6 to 10 digits.

### KRA PIN certificates

Sentinel checks that the document is a KRA certificate and that the PIN has the right format: A for an individual or P for a company, nine digits, then a letter. It checks that the first letter matches the taxpayer type on the certificate. Where Sentinel's connection to KRA is available, it also looks the PIN up in KRA's own records. The **KRA records** row shows what KRA said.

![KRA PIN certificate report for Daniel Ouma, needs review](/help/shots/b5-report-kra.png "TODO")

## What each result means

### Verdicts

| Verdict on the report | In the list | What it means | What to do |
|---|---|---|---|
| **Verified** | Verified | No fraud signals and every check passed. | Accept the document. |
| **Needs review** | Needs review | At least one high or medium finding, such as a name mismatch, an old proof of address or a poor image. | Read the findings and decide the case in **Reviews**. |
| **Rejected — fraud or invalid document** | Rejected | At least one critical finding, such as an AI-generated image, a failed MRZ check digit or an expired document. | Don't accept it. Ask for the original document. A case is still opened at high priority. |
| **Could not be verified** | Failed | The file couldn't be read, for example a blurred or cropped photo. | Ask for a clearer, uncropped image and submit again. You aren't charged. |

### Findings

Each finding has a severity and a source. **Critical** findings reject the document. **High** and **medium** findings send it to review. **Low** findings are notes only. The source tells you which layer found it: **File forensics**, **Machine-readable zone**, **Validation rules**, **AI visual review** or **OCR cross-check**.

When any finding points to AI generation, a red banner under the header says "AI-generated document suspected". In the demo, Daniel Ouma's ID shows this: the background pattern melts into the photo and the small print is garbled.

![Rejected report for Daniel Ouma's ID with the AI-generated banner](/help/shots/b5-report-ai.png "TODO")

### Your organization's document rules

An Admin can change two outcomes in **Settings** → **Screening rules** → **Documents (IDP)**:

- **AI-generated document**: **Reject automatically** (the default) or **Send to review**.
- **Other document fraud**: **Reject automatically** (the default) or **Send to review**.

The same section sets the default **Proof of address maximum age (days)** (90 by default) and the **Accepted proof of address documents**. A document type you don't accept can't pass and goes to review. When a rule changes the verdict, the report's reason says so.

## Common questions

### How many credits does a document check cost?

An identity document or KRA PIN certificate costs the same as one document verification. A proof of address costs more. On Kenyan shilling plans that is 1 credit and 2 credits. Your exact prices are in **Billing & Credits** under **Your prices**. You are charged only when the check completes.

### Does the Age 18+ check reject a minor?

No. The check shows whether the holder is 18 or over, but on its own it doesn't change the verdict. If your product needs an adult customer, look at the **Age** row before you accept.

### Does Sentinel keep the document image?

No. Sentinel reads the image and keeps only the extracted data and findings. Keep your own copy of the original.

### What if the KRA check says "Not checked with KRA"?

The PIN couldn't be read in a valid format, or KRA's records weren't available at the time. The other checks still ran. Confirm the PIN on KRA's own PIN checker if you need to.

### Can I challenge a result I think is wrong?

Yes. Click **Dispute this result** at the top of the report. DeepTrack's review team looks at it. See [B15 Disputes](/help/b15).

### Is a finding proof of fraud?

No. Findings are leads for a person to review. AI reading can misread a poor image, so compare with the original document before you act.

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [B15 Disputes](/help/b15)
- [C3 Documents API](/help/c3)
