---
id: b2
title: KYC identity checks
summary: Run a KYC identity check from the dashboard and read what each step found: document, selfie, face match, IPRS, AML and liveness.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

A KYC (know your customer) identity check confirms that a customer is who they say they are. You upload a photo of their ID and a selfie, and type their details. Sentinel then runs several checks and gives one result: **Approved**, **Needs Review** or **Declined**.

The checks are:

- **Document authenticity**: is the ID genuine, or does it show signs of forgery or editing?
- **DeepTrack Live selfie check**: is the selfie a real face, or a fake or AI-made (synthetic) one?
- **Face match**: is the person in the selfie the person on the ID?
- **IPRS**: do the ID number and details match Kenya's national population register?
- **AML screening**: is the person on a sanctions list, a PEP (politically exposed person: someone who holds or held a prominent public role), or in adverse media (negative news)?
- **Liveness**: was a real person in front of the camera at the time? This needs a short video or frame capture, not a still photo.

You can also let the customer do the photos on their own phone. See [B3 Capture links](/help/b3).

## Who can use it

- **Admin**, **Analyst**, **Reviewer** and **Developer** can run a check.
- Everyone in your organization, including **Viewer / Auditor**, can see the KYC list and open reports. A Viewer / Auditor sees the **New Verification** button but can't submit a check.
- Only **Admin**, **Analyst** and **Reviewer** can open **View review status** and dispute a result.
- Your own team decides checks that need review, in **Reviews**. Settings → **Review workflow** may limit who can clear what. See [B11 Deciding a review case](/help/b11).

## Step by step

### Open the KYC page

1. Click **Identity (KYC)** in the sidebar. The **KYC Verifications** page opens.
2. The cards at the top count **Total**, **Approved**, **Pending + Processing**, **Needs Review** and **Declined** for the 50 most recent checks.
3. Search by name or reference, or filter by status. Click **View** on a row to open its report.

![KYC Verifications page for Demo Bank Ltd](/help/shots/b2-kyc-list.png)

### Run a new check

1. Click **New Verification**. The **Identity Verification** page opens with three steps.
2. **Document Capture**: choose **Passport**, **National ID** or **Driver's License**. Upload the **Photo page** for a passport. For a National ID or driving licence, upload **Step 1 of 2: Front side** and **Step 2 of 2: Back side**. Click **Continue**.
3. **Selfie Capture**: upload a clear, front-facing **Selfie** of the customer. Click **Continue**.
4. **Review & Submit**: type **First name**, **Last name**, **ID / document number**, **Date of birth** and **Gender** exactly as on the ID. The ID number must be 5 to 20 letters or digits, with no spaces. The customer must be at least 18.
5. Check the summary. It shows **Liveness: Not collected in this flow**. Click **Edit captures** to change a photo.
6. Tick the consent box and click **Submit Verification**.

![Review & Submit step with identity details filled in](/help/shots/b2-new-submit.png "TODO")

The page shows **Verification Submitted** with the check's reference. It updates by itself while Sentinel works, usually within a few minutes. Click **View report** to open the report.

### Read the report

The report opens with the customer's name, reference and status badge. It also has the **Download report (PDF)** and **Dispute this result** buttons. Below that you see:

1. **Deepfake shield · DeepTrack Live**: one headline for every deepfake and forgery signal. It lists **Selfie: real face**, **Liveness: no deepfake** and **ID document: not forged**, each marked **Clear**, **Flagged**, **Unclear** or **Not run**.
2. **Verification Report**: one box per step, described below.
3. **Fraud network**, when the ID number has been seen with another person. See [B10 Fraud signals explained](/help/b10).

![Report for Wanjiku Mwangi with every step passed](/help/shots/b2-report-pass.png)

## What each result means

### The overall status

| Status | What it means | What to do |
|---|---|---|
| **Pending** / **Processing** | Sentinel is still running the checks. | Wait. The page updates by itself. |
| **Approved** | Every step passed, including liveness. | Onboard the customer under your policy. |
| **Needs Review** | At least one step was unclear, failed in a way that needs a person, or liveness wasn't collected. | Decide the case in **Reviews**. Click **View review status** to see why. |
| **Declined** | A step failed clearly, or the check couldn't be completed. A failed check shows a **Failure reason**. | Don't onboard on this check. If it failed for a technical reason, run it again. |

A check run from **New Verification** or a capture link has no liveness capture. So even when every other step passes, it ends as **Needs Review**, never **Approved**. Only a check sent with a liveness capture through the API can be approved automatically. See [C2 KYC API](/help/c2).

### Each step

| Step | Passes when | Otherwise |
|---|---|---|
| **Document Authenticity** | The forgery score is 25% or less and there are no flags. | The check goes to review. |
| Selfie (in the deepfake shield) | DeepTrack Live says "real" with at least 70% confidence and no warning. | "Fake" at 90% confidence or more declines the check. Anything less certain goes to review. |
| **Face match** | **Match**: similarity of 90% or more. | **Unclear** (70% to 90%), **No match** (under 70%) or **No face** goes to review. Face match never declines on its own. |
| **Identity Registry (IPRS)** | **MATCH**. | **PARTIAL MATCH**, **NO MATCH** or **TIMEOUT** goes to review. **INVALID** (bad ID format) or **REVOKED** (reported lost or stolen) declines. |
| **AML / Sanctions Screening** | **CLEAR**. | **SANCTIONS HIT** declines. **PEP**, **ADVERSE MEDIA**, or a match scoring 60% or more goes to review. |
| **Liveness Check** | Liveness score of 85% or more and no deepfake. | Goes to review. |

Some things to know when you read the steps:

- Steps run in order. If the document, selfie or liveness step needs review, IPRS and AML don't run, and their boxes say "This step did not run for this verification."
- If a provider was down, the box says so, for example "The verification provider timed out before responding." The check goes to review, never straight to **Declined**.
- **Duplicate face** means the same face is on another of your customers under a different identity. Your Admin turns this search on in Settings → **Screening rules** → **Search for the same face among your customers**. It is off by default.

![Report for Brenda Atieno: face match No match, same face as another customer](/help/shots/b2-report-mismatch.png)

## Common questions

### How much does a check cost?

One KYC check costs 1 credit on KES plans. On USD plans the price depends on your plan. The AML step is included. A passed or declined check is charged when it finishes. A check in review is charged when your team decides it. A check that fails for a technical reason isn't charged. See [A12 Usage and reports](/help/a12).

### What if we run out of credits?

Sentinel won't start the check. You see "Insufficient credits for this verification." Ask your Admin to top up in **Billing & Credits**.

### Why did a clean check end in Needs Review?

The dashboard flow uses a still selfie, which can't prove the person was present. Sentinel holds these checks for a person to decide. To confirm presence, send a liveness link. See [B4 Remote liveness](/help/b4).

### Can I undo or change a result?

Not from the report. Your team decides **Needs Review** checks in **Reviews**. If you think a pass or a decline is wrong, click **Dispute this result**. See [B15 Disputes](/help/b15).

### How long is a check kept?

The photos you upload in **New Verification** are stored with the check, along with the customer's details and the step results. The check is kept for your retention period, 7 years by default. An Admin sets it in Settings → **Audit & data**.

### Can I turn face match off?

Yes. An Admin can clear **Compare the selfie with the ID photo** in Settings → **Screening rules**. The report then shows face match as **Not run**. See [A7 Screening rules](/help/a7).

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B3 Capture links: KYC on the customer's phone](/help/b3)
- [B4 Remote liveness](/help/b4)
- [B5 Document checks](/help/b5)
- [B6 AML screening](/help/b6)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [A7 Screening rules](/help/a7)
- [A12 Usage and reports](/help/a12)
- [C2 KYC API](/help/c2)
