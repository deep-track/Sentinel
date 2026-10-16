---
id: b10
title: Fraud signals explained
summary: Know what the fraud network, duplicate faces, deepfakes and AI-forged documents mean on a report, and what to do about each.
roles: Admin, Reviewer, Analyst, Viewer / Auditor
---

## What it's for

Sentinel looks for four kinds of identity fraud on top of the normal checks:

- **Fraud network**: the same ID number, document number or email turning up with a different person.
- **Duplicate faces**: one person onboarding under two or more identities.
- **Deepfakes**: a fake, synthetic or replayed face in the selfie or liveness video.
- **AI forgeries**: an identity document that was AI-generated, edited, or had its photo replaced.

Below: what each signal means, how it changes the verdict, and what to do.

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Viewer / Auditor** see these signals on KYC, document, AML and KYB reports. **Developer** sees them on document and AML reports only.
- **Admin**, **Reviewer** and **Analyst** act on them by deciding the review case. See [B11 Deciding a review case](/help/b11).
- Only an **Admin** can turn the optional signals on or off, in **Settings** → **Screening rules**.

## Step by step

### Find the signals on a report

1. Open the check. See [B9 Reading a report and its PDF](/help/b9).
2. Read the deepfake shield at the top of a KYC or document report.
3. On a KYC report, read the **Face match** row in the **Verification Report**. A duplicate face shows here.
4. Read the **Fraud network** section.

![KYC report for Brenda Atieno with a face match of No match and the same face under another identity](/help/shots/b10-duplicate-face.png "TODO")

### Turn on the optional signals

Duplicate face search and the shared Sentinel network are off by default. An Admin turns them on:

1. Click **Settings**, then **Screening rules**.
2. Under **Face match**, make sure **Compare the selfie with the ID photo** is on, then turn on **Search for the same face among your customers**.
3. Under **Fraud network**, turn on **Join the Sentinel network** to compare your checks with those of other organizations that joined.
4. Click **Save changes**.

Before you turn on duplicate face search, check that your privacy notice and customer consent cover it. Sentinel keeps a face template (not the photo) for each KYC check, and that is biometric data under the Data Protection Act.

![Screening rules with the Face match and Fraud network sections](/help/shots/b10-settings.png "TODO")

## What each result means

### Fraud network

Sentinel takes a fingerprint of the identifiers in each finished check and compares it with up to 50 earlier checks carrying the same identifier. It keeps only the fingerprints, never the numbers, names or dates. A finding never says which organization saw the identifier.

What is compared:

- KYC: the ID number.
- Documents: the document number and the ID or personal number.
- AML (individuals): the ID number.
- KYB: each director's ID number and email address.

| Finding | Strength | What it means |
|---|---|---|
| "This ID number was used with a different name…" | **Strong** | The same ID or document number came with a name that shares less than half its parts with this one. |
| "…with a different date of birth…" | **Strong** | The same ID or document number came with another date of birth. |
| "…was in a check rejected for fraud…" | **Strong** | An earlier check with this identifier was rejected for document fraud, or a reviewer rejected it with a reason that mentions fraud, forgery, tampering or a fake. |
| "This email address was used by 1 other person…" | **Weak** (1 or 2 people), **Strong** (3 or more) | One email shared by several people. |

A strong finding turns a pass into review. It never rejects. A weak finding is shown on the report and changes nothing.

"In the Sentinel network" means at least one earlier check belonged to another organization; "in your checks" means they were all yours.

**What to do:** ask the customer to explain. A typing mistake in the ID number, or a family sharing one email, is common. If the numbers are right and the names differ, ask for the original ID, and treat it as possible identity theft. Consider an STR. See [B14 Filing an STR or SAR](/help/b14).

### Duplicate faces

With duplicate face search on, each KYC selfie is compared with your own customers' faces. Only your organization's checks are searched, never another organization's. A face at 95% similarity or more counts as the same face.

- The same face under the **same** identity (same ID number, or a similar name when there is no ID number) is a returning customer. The report says "seen before under the same identity" and the verdict is unchanged.
- The same face under a **different** identity holds the check for review. The **Face match** badge turns red. It says **Duplicate face** when the selfie matches the ID, or **Unclear** or **No match** when it doesn't. The detail names the other check, for example "Same face under a different identity: KYC-… (99.1%)".

**What to do:** search for the other reference on **Identity (KYC)** and compare the two checks side by side. One person with two national IDs is a red flag for identity fraud. Reject the new check, review the earlier one too, and consider an STR.

The face match itself also holds a check: **Match** (90% similarity or more) passes, **Unclear** (70 to 90%), **No match** (below 70%) and **No face** all go to review.

### Deepfakes

DeepTrack Live checks the face for a deepfake or synthetic face. It shows in the deepfake shield as **Selfie: real face**, **Liveness: no deepfake** and **Liveness video: real face**.

| Shield line | What happens to a KYC check |
|---|---|
| **Flagged**: fake or synthetic face, 90% confidence or more | Rejected straight away. |
| **Flagged**: fake, below 90% confidence | Held for review. |
| **Unclear**: probably real but below 70% confidence, or DeepTrack Live couldn't tell | Held for review. |
| **Flagged**: the liveness capture was flagged as a deepfake | Held for review. |
| **Clear**: a real face at 70% confidence or more | No change. |
| **Not run**: the service was unavailable, or no liveness was collected | Held for review. |

**What to do:** never approve a flagged face on the photo alone. Ask the customer to redo the check with a live capture, or to come to a branch. A confident fake is attempted fraud, so consider an STR.

![KYC report for James Mutua, Declined, with the selfie flagged as a fake or synthetic face](/help/shots/b10-fake-selfie.png "TODO")

### AI forgeries

Sentinel's document forensics look at the file and the image. They show in the shield as **AI-generated document**, **Edited or tampered document** and **Photo substitution**. On a KYC check, the shield line is **ID document: not forged**: a forgery score above 50% is flagged, and 25 to 50% is unclear.

- **AI-generated document**: visual signs of image generation, an AI generator recorded in the file, or content credentials saying the image was made by AI.
- **Edited or tampered document**: editing software in the file, a PDF changed after it was made, or text and numbers changed.
- **Photo substitution**: the holder photo looks replaced.

A confident finding is critical and rejects the document. By default **AI-generated document** and **Other document fraud** are set to **Reject automatically**; an Admin can set either to **Send to review** under **Settings** → **Screening rules** → **Documents (IDP)**. A less certain finding sends the document to review. Either way a case opens on **Reviews**.

**What to do:** ask for the original document, and don't accept a re-upload of the same file.

## Common questions

### Do these checks cost extra credits?

No. The fraud network, face match, duplicate face search and the deepfake shield are part of the check's normal price.

### Can a fraud signal reject a customer on its own?

Only a confident one. A DeepTrack Live fake at 90% or more rejects a KYC check, and a critical document finding rejects a document unless your rules send it to review. The fraud network and face match only hold a check for review.

### Does joining the Sentinel network share our customers' details?

No. Only keyed fingerprints are compared. Other organizations never learn the number, the name or that the customer is yours. Your own checks are always compared, whether you join or not.

### How long are face templates and fingerprints kept?

They are kept with the check. Once a check is older than your retention period (7 years by default), an Admin can ask to remove it and a second Admin approves. The face template and fingerprints go with it.

### What if the signal is wrong?

Approve the review case with your reason. For a rejected KYC check, click **Dispute this result**. See [B15 Disputes](/help/b15).

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B4 Remote liveness](/help/b4)
- [B5 Document checks](/help/b5)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B14 Filing an STR or SAR](/help/b14)
- [B15 Disputes](/help/b15)
