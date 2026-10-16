---
id: b9
title: Reading a report and its PDF
summary: Read the verdict, deepfake shield, fraud network and risk rating on any check's report, and download it as a PDF for your file.
roles: Admin, Reviewer, Analyst, Viewer / Auditor, Developer
---

## What it's for

Every finished check has a report page: KYC identity checks, documents, AML screenings and business (KYB) checks. The report shows the verdict, why Sentinel reached it, and the evidence behind it. You can download the same report as a PDF to keep on the customer's file or show an examiner from CBK, SASRA or the FRC.

This chapter walks through the parts that appear across the reports. The checks themselves are covered in their own chapters.

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Viewer / Auditor** can open all four kinds of report and download their PDFs.
- **Developer** can open document and AML reports. KYC and KYB checks don't open for a Developer.
- Downloading a PDF doesn't use credits.

## Step by step

### Open a report

1. In the sidebar, click the kind of check: **Identity (KYC)**, **Documents (IDP)**, **AML Screening** or **Business (KYB)**.
2. Open the check:
   - **Identity (KYC)**: click the row, or **View**.
   - **Documents (IDP)** and **AML Screening**: click the result button that ends in **View report**.
   - **Business (KYB)**: click the eye icon on the row.

### Read the verdict

1. Look at the top of the report. The customer's or business's name is the title, with the check's reference under it.
2. Read the verdict badge next to it. The wording differs by kind of check (see the table below).
3. Read the reason under the title, where the report has one. Document and AML reports explain the verdict in one or two sentences. A document report also shows a **Fraud risk score** out of 100.
4. On a KYC report, read the **Verification Report** section. Each step (**Document Authenticity**, **Liveness Check**, **Identity Registry (IPRS)**, **AML / Sanctions Screening**, **Face match**) shows its result and the threshold it was judged against.

![KYC report for Wanjiku Mwangi, Approved, with the deepfake shield clear](/help/shots/b9-kyc-report.png "TODO")

### Read the deepfake shield

KYC and document reports show the deepfake shield near the top: one headline for every deepfake and AI-forgery check that ran.

1. Read the headline in the coloured box under **Deepfake shield · DeepTrack Live**.
2. Read the list under it. Each line is one check, marked **Clear**, **Flagged**, **Unclear** or **Not run**, with a short detail.
3. If anything is **Flagged** or **Unclear**, read [B10 Fraud signals explained](/help/b10) for what it means and what to do.

![Document report for Daniel Ouma, Rejected, with the deepfake shield showing an AI-generated document](/help/shots/b9-document-report.png "TODO")

### Read the fraud network

1. Find the **Fraud network** section. On document and AML reports it is a section of its own. On a KYC report it sits at the end of the **Verification Report**. On a KYB report it is under **Automated checks**, as **Fraud network (directors' ID numbers and emails)**.
2. If nothing was found, it says **No reuse found**. Otherwise each finding is marked **Strong** or **Weak**, with a sentence such as "This ID number was used with a different name in your checks."
3. The last line says how many identifiers were compared, and whether only your organization's checks were used or the Sentinel network as well.

### Read the risk rating

AML and KYB reports show a **Customer risk rating** (on KYB, under **Automated checks**).

1. Read the badge: **Low risk**, **Medium risk**, **High risk** or **Prohibited risk**, with the score out of 100.
2. Read the line next to it. It says how often the customer must be reviewed, for example "Review every 12 months."
3. Read the factors under it. Each one shows its points and why, for example "PEP +35: Politically exposed person, Class 2".

![AML report for Daniel Kipruto Langat with a High risk rating and a PEP Class 2 hit](/help/shots/b9-aml-risk-rating.png "TODO")

### Download the PDF

1. Click **Download report (PDF)** at the top of the report.
2. The PDF is created in your browser and saved to your downloads. It is named after the check, for example `KYC-report-<reference>.pdf` or `AML-report-<reference>.pdf`.
3. If the PDF can't be created, Sentinel opens your browser's print window instead, so you can print or save the page.

The PDF carries the same verdict, deepfake shield, fraud network, risk rating and findings as the page. Times are in East Africa Time. Each page has a "Confidential" footer and a page number. ID numbers on KYC and KYB PDFs are masked. A report that is held or rejected ends with **Decision**, **Reviewed by** and **Date** lines for a signature.

Document and AML reports also offer **Evidence (JSON)**: the full result as a data file. AML reports offer **Matches (CSV)** for the hits as a spreadsheet.

## What each result means

| Check | Badge | What it means | What you do |
|---|---|---|---|
| KYC, KYB | **Approved** | Every step passed. | Nothing. |
| KYC, KYB | **Needs Review** | Held for a person. | Decide it on **Reviews**. See [B11](/help/b11). |
| KYC, KYB | **Declined** | Rejected, or the check failed to run. Read the **Failure reason** row if there is one. | Don't onboard. Dispute it if you think it's wrong. |
| Documents | **Verified** / **Needs review** / **Rejected — fraud or invalid document** / **Could not be verified** | Pass / held / rejected / processing failed. | As above. |
| AML | **Clear** / **Needs review** / **Match — do not proceed** / **Screening failed** | No hits / hits to check / a sanctions match / screening failed. | As above. |

| Deepfake shield headline | What it means |
|---|---|
| **No deepfake or AI forgery detected** | Every check that ran was clear. |
| **Possible deepfake or AI forgery: a person should look** | At least one check was unclear and none flagged. |
| **Deepfake or AI forgery detected** | At least one check flagged a fake face, a deepfake or a forged document. |
| **The deepfake check didn't run** | No check could run, for example the service was unavailable. |

| Risk level | Review every (default) |
|---|---|
| **Low** | 36 months |
| **Medium** | 24 months |
| **High** | 12 months, with enhanced due diligence |
| **Prohibited** | Exit or don't onboard: a confirmed sanctions match. |

An Admin can change the review periods in **Settings** → **Screening rules** → **Customer risk rating and periodic review**.

## Common questions

### Why doesn't my KYC report show a risk rating?

The risk rating is worked out for AML screenings and business checks. To rate an individual, screen them under **AML Screening**. See [B12 Customer risk and periodic reviews](/help/b12).

### Why is there no deepfake shield on an AML or KYB report?

Those checks don't look at faces or identity images, so there is nothing for the shield to check.

### Can I add our logo to the PDF?

Not yet. Every PDF carries the DeepTrack logo. The AML report page shows your logo, and the AML PDF prints your legal name, registration number, regulator and compliance contact, all taken from **Settings** → **Organization**.

### Is the PDF a copy of the page at the time I download it?

Yes. If a reviewer decides the case later, download it again to get the decision on file.

### How long can I open a report?

As long as your organization keeps the check. Once a check is older than your retention period (7 years by default), your Admins can remove its personal data. One Admin asks and a second approves. After that the report shows only the reference, type, verdict and dates.

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B5 Document checks](/help/b5)
- [B6 AML screening](/help/b6)
- [B8 Business checks (KYB)](/help/b8)
- [B10 Fraud signals explained](/help/b10)
- [B12 Customer risk and periodic reviews](/help/b12)
