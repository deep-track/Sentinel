---
id: b1
title: How Sentinel decides
summary: Understand pass, review and reject, why any doubt goes to a person, and what the AI only recommends while your team decides.
roles: Admin, Reviewer, Analyst, Viewer / Auditor, Developer
---

## What it's for

Every check in Sentinel ends with one of three verdicts: pass, review or reject. This chapter explains how Sentinel chooses between them, so you know what each verdict promises and when a person has to step in.

Sentinel is built to fail closed. A check only passes when every step comes back clearly clean. If a step is unclear, a service is down or a signal points to possible fraud, the check is held for review. It does not guess.

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Viewer / Auditor** can open every check and see its verdict. **Developer** can open document and AML reports, but not KYC or KYB checks.
- **Admin**, **Reviewer** and **Analyst** can decide review cases. Who makes the final decision depends on the kind of case and on your rules in **Settings** → **Review workflow**. See [B11 Deciding a review case](/help/b11).
- Only an **Admin** can change the rules that move a check between verdicts, in **Settings** → **Screening rules**.

## Step by step

### See why a check got its verdict

1. Open the check from its list: **Identity (KYC)**, **Documents (IDP)**, **AML Screening** or **Business (KYB)** in the sidebar.
2. Read the verdict badge at the top of the report.
3. Read the reason under the title, or the step-by-step results lower down. Each step shows what it found and the threshold it was judged against.
4. If the check is held, follow the link to the case. On a KYC check, click **View review status →**. On an AML report, click **Open the case to decide it →**. Your team decides the case on the **Reviews** page.

![KYC report for Brenda Atieno with the Needs Review badge](/help/shots/b1-review-verdict.png)

### How a KYC check reaches its verdict

A KYC check (know your customer: confirming a person is who they say they are) runs its steps in order and stops at the first one that needs a person.

1. Liveness, the document scan and the selfie check run first. A liveness score below 85%, a deepfake flag, a document forgery score above 25%, any document flag, or a selfie that isn't clearly a real face holds the check for review.
2. IPRS (Kenya's national population register) confirms the ID. A partial match, no match or a timeout holds the check. An invalid ID number or an ID reported lost or stolen rejects it.
3. AML screening (anti-money laundering: sanctions, PEP and watchlist checks) runs next. A sanctions hit rejects. A PEP, adverse media or a match scored 60 or more holds the check.
4. Face match compares the selfie with the ID photo. Anything short of a clear match holds the check.
5. The fraud network looks for the ID number used by another person. A strong signal turns a pass into review.
6. A check without a liveness capture is always held, even when everything else is clean.

## What each result means

| Verdict | On screen | What it means | What you do |
|---|---|---|---|
| Pass | **Approved** (KYC, KYB), **Verified** (documents), **Clear** (AML) | Every step came back clean against its threshold. | Nothing. Onboard the customer under your normal process. |
| Review | **Needs Review** or **Needs review** | Something is unclear, a service didn't answer, or a fraud signal needs a person. | Decide the case on **Reviews**. Approve passes the check; reject rejects it. |
| Reject | **Declined** (KYC, KYB), **Rejected — fraud or invalid document** (documents), **Match — do not proceed** (AML) | A clear, serious finding: a confident fake face, an invalid or stolen ID, a sanctions hit, or a critical document flag. | Don't onboard. For documents, AML and KYB a rejection also opens a high-priority case, so a person confirms it. |

### Why a doubt always goes to a person

- A service outage never rejects. If liveness, the document scan, IPRS or AML screening can't be reached, the check is held for review instead.
- Face match and the fraud network can only hold a check. They never reject on their own.
- Sentinel never turns a review into a pass by itself. Only a person on your team (or DeepTrack's review team, on a dispute) can do that.

### What the AI recommends and what only people decide

| AI does | People decide |
|---|---|
| Reads documents and flags signs of AI generation, editing or photo substitution. | Whether a flagged document is genuine, in the review case. |
| DeepTrack Live scores the selfie and liveness video for deepfakes and synthetic faces. | Whether an unclear face is real. |
| The AI hit review compares the customer with each AML hit and recommends **Clear the hits**, **Confirm the match** or **Get more information**. | Every final approve or reject, under your four-eyes and clearance rules. |
| Reads adverse media articles and judges whether they are about this customer. | Whether to file an STR (suspicious transaction report) with the FRC. |

Two AI findings can reject without a person: a DeepTrack Live "fake" at 90% confidence or more on a KYC selfie, and a critical document flag such as an AI-generated ID. For documents, an Admin can send these to review instead (see below).

## Common questions

### Can I make Sentinel send document rejections to review instead?

Yes. An Admin can change **AI-generated document** and **Other document fraud** in **Settings** → **Screening rules** → **Documents (IDP)** from **Reject automatically** to **Send to review**. The default for both is **Reject automatically**.

### Does a KYC rejection open a review case?

No. A rejected KYC check is final. If you think it is wrong, click **Dispute this result** on the check within 90 days, and DeepTrack's review team looks at it. See [B15 Disputes](/help/b15).

### Is a check in review charged?

A KYC check held for review is charged when your team makes the final decision. A pass or a rejection is charged when the check completes.

### Can the AI hit review clear a hit on its own?

No. It only recommends, with its reasons. A person on your team makes every decision.

### Why was a clean check held for review?

Usually because liveness wasn't collected, the face match was unclear, or the fraud network found the ID number used with another name. The reason is shown on the report and on the case.

## Related chapters

- [B2 KYC identity checks](/help/b2)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [B15 Disputes](/help/b15)
