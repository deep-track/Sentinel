---
id: b8
title: Business checks (KYB)
summary: Submit a business for KYB, and read its certificate, CR12, BRS register, KRA PIN, ownership tree and AML results.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

KYB (know your business) checks a company before you take it on as a customer. You enter the business, upload two documents and list its directors and owners. Sentinel then runs these checks:

1. **Registration certificate.** Sentinel reads the certificate of incorporation, business name certificate or CR12 (the official BRS search showing directors and shareholders). It matches the name, registration number and directors to what you entered, and looks for signs of forgery.
2. **Proof of address.** Sentinel checks the utility bill or bank statement in the business's name, with the same document checks as [B5 Document checks](/help/b5). It must be no more than 90 days old.
3. **BRS register** (Kenyan businesses only). Sentinel looks the registration number up with the Business Registration Service. It checks the registered name, whether the company is active, and who the shareholders are.
4. **KRA PIN.** If the BRS record has a KRA PIN, Sentinel checks it with KRA and confirms it belongs to the business.
5. **Beneficial ownership.** Where a shareholder is itself a company, Sentinel looks that company up in BRS too, up to three levels. It works out each person's effective share of the business. A beneficial owner is a person who ends up with 10% or more, the threshold in Kenya's beneficial ownership regulations.
6. **AML screening.** Sentinel screens the business, every person you listed, and owners found on the register for sanctions, PEPs (politically exposed persons: people who hold or held a prominent public role) and adverse media.

The BRS, KRA and ownership checks run only when the country is Kenya and the registry lookup is available. For other countries, steps 1, 2 and 6 run.

## Who can use it

- **Admin**, **Analyst**, **Reviewer** and **Developer** can submit a business.
- Every role, including **Viewer / Auditor**, can open the KYB list and results. A Viewer who tries to submit gets an error at the last step.
- A business that needs review becomes a case in **Reviews**. Who can decide it is set in **Settings** → **Review workflow**. See [B11 Deciding a review case](/help/b11).

## Step by step

### Submit a business

1. Click **Business (KYB)** in the sidebar, then **New Verification**.
2. **Business Info**: enter the **Business Name**, the **Registration Number** (for example PVT-AB1CD2E) and the **Country**. Click **Continue**.
3. **Business Documents**: upload the **Incorporation Certificate** and the **Utility Bill**. Each can be a PDF, JPG or PNG of up to 8 MB. For a Kenyan company, upload a recent CR12 as the certificate where you can, because it lists the shareholders. Click **Continue**.
4. **UBO & Directors**: for each person, enter **First Name**, **Last Name**, **Date of Birth**, **Email Address**, **ID / Passport Number** and **Position** (**Director**, **Shareholder** or **Beneficial Owner**). **Shareholding %** is optional. Click **Add Another Person** for each extra person, up to 50. Click **Continue**.
5. **Review & Submit**: check the summary. Click **Edit** on any section to change it.
6. Tick the box that starts "I confirm that all information provided is accurate", then click **Submit**.
7. Sentinel shows the reference and opens the result page after 5 seconds.

![UBO & Directors step with two people entered](/help/shots/b8-wizard-people.png)

List everyone who owns 10% or more, and every director. Sentinel compares your list with the register. Anyone it finds that you didn't list sends the business to review.

### Read the result

1. Open the business from the **Business (KYB)** list. You can search by business name or reference, or filter by status.
2. Read the status badge at the top. **Download report (PDF)** and **Dispute this result** are next to it.
3. Read the one-line reason at the top of **Automated checks**. It names everything that needs a person.
4. Work down the sections: **Registration certificate**, **Proof of address**, **Company registry (Kenya BRS)** with the KRA PIN and the ownership tree, and **AML screening**. Each check shows a tick or a cross.
5. **Directors & UBOs** at the bottom lists the people you entered, with ID numbers masked.

![KYB result for Savannah Agri Holdings Ltd, needs review](/help/shots/b8-result.png)

### Read the ownership tree

Each line is one shareholder. Indented lines are the owners of the company above them. Each line shows whether it's a company or a person, the share it holds in its own company, and its effective share of the business you're checking. People at 10% or more are marked **Beneficial owner**.

An amber note under a company means Sentinel couldn't see past it. For example, the company has no registration number on the register, wasn't found in BRS (it may be foreign), or is more than three levels deep. Ask the customer for that company's ownership.

In the demo, Savannah Agri Holdings Ltd is 60% owned by Peter Njoroge and 40% by Highland Capital Limited. Highland is owned 70% by Ahmed Hassan Farah and 30% by Lucy Wairimu. That gives them 28% and 12% of Savannah. Neither was declared, so the business needs review.

![Ownership tree for Savannah Agri Holdings Ltd](/help/shots/b8-ownership.png)

## What each result means

### Business status

| Status | What it means | What to do |
|---|---|---|
| **Pending** | Submitted, waiting to start. | Wait. |
| **Processing** | The checks are running. The register can take up to 90 seconds to answer. | Wait. |
| **Approved** | Everything matched, and the business and every person screened clear. | Onboard the business. |
| **Needs Review** | Something needs a person: a mismatch, an out-of-date CR12, an undeclared owner, a possible AML match, or a check that couldn't run. | Read the reason and decide the case in **Reviews**. |
| **Declined** | A strong AML match, or a forged or impossible certificate. Also shown if the submission failed. | Don't onboard. Escalate to your MLRO (money laundering reporting officer) if needed. |

### Section results

Each section shows **Passed**, **Needs review**, **Rejected** or **Not checked**. **Not checked** means that part couldn't run, for example the register didn't answer in time. If the register answers later, an amber line shows its answer.

### Common certificate and register findings

- **CR12 issued in the last 90 days** fails: the CR12 is too old. Ask for a new one.
- **CR12 shareholders match the BRS register** fails: someone is on the CR12 but not on the register (a sign of a forged or altered CR12), or the other way round (the CR12 may be out of date).
- **Registration is active** fails: the register says the company isn't active.
- **Shareholders on the register were declared** fails: you didn't list someone who is on the register.
- **KRA PIN confirmed by KRA** fails: KRA has no record of the PIN, has it under another name, or shows it as not active.

### Director status

In **Directors & UBOs**, **Verified** means the person's AML screening was clear. **Failed** means it was rejected. **Pending** means it needs review or hasn't run.

## Common questions

### How many credits does a KYB check cost?

One Enhanced KYB check. On Kenyan shilling plans that is 5 credits. Your exact price is in **Billing & Credits** under **Your prices**. AML screening of the business and its people is included. If part of the check couldn't run, the charge is taken when your team decides the case.

### What if the business isn't Kenyan?

Sentinel still reads the certificate, checks the proof of address and screens everyone. There is no register, KRA or ownership check, so confirm ownership from the documents yourself.

### Do the directors receive an email?

No. Sentinel screens the people you list but doesn't contact them. To verify a director's identity, run a KYC check on them. See [B2 KYC identity checks](/help/b2).

### What if the owner is a foreign company?

Sentinel can't look it up in BRS. The tree marks it "Not found in BRS (possibly a foreign company)" and the business goes to review. Ask the customer for that company's register extract.

### Are the uploaded documents kept?

Yes. The two documents are linked from the result page under **Incorporation certificate** and **Proof of address**. They are kept for your data retention period, which is at least seven years by default (**Settings** → **Audit & data**).

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B5 Document checks](/help/b5)
- [B6 AML screening](/help/b6)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B15 Disputes](/help/b15)
