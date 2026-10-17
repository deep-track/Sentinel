---
id: b11
title: Deciding a review case
summary: Work a case from the Reviews queue: read the hits, use the AI hit review, approve or reject with a reason, and get a second approval.
roles: Admin, Reviewer, Analyst
---

## What it's for

When a check can't be decided automatically, Sentinel opens a review case on the **Reviews** page. Examples are a sanctions hit, a PEP hit (PEP: politically exposed person, someone who holds or held a prominent public role), adverse media, or a document that looks altered or AI-generated.

You read the evidence, then approve the case (the flag was wrong, so the check passes) or reject it (the flag was right). Your organization's rules decide who makes the final decision, and which cases need a second person (four-eyes approval).

## Who can use it

- **Admin**, **Reviewer** and **Analyst** can work cases: take them, run the AI hit review, recommend or decide, and escalate.
- **Viewer / Auditor** can open the queue and read cases, but can't act on them.
- **Developer** can't use Reviews.
- Only a **Reviewer** or **Admin** can assign a case to someone else.
- Who can make the *final* decision depends on the kind of case. An Admin sets this in **Settings** → **Review workflow** → **Who can decide what**. The defaults are:

| Case category | Final decision by | Needs two people (four-eyes) |
|---|---|---|
| Sanctions hit | Admin | Yes |
| PEP | Reviewer or above | Yes |
| Adverse media | Reviewer or above | No |
| Document fraud or AI-generated | Reviewer or above | Yes |
| Other high-risk case | Reviewer or above | No |
| Standard case | Analyst or above | No |

**Maker-checker** is on by default. The person who ran a check can't make the final decision on it. Their decision becomes a recommendation instead.

## Step by step

### Find a case

1. Click **Reviews** in the sidebar. The queue opens on **All open**.
2. Pick a view: **Assigned to me**, **Unassigned**, **Awaiting my approval**, **Overdue**, **All open** or **Closed**. The number next to each view is its count.
3. To see one kind of check, choose from the **Queue** list: **KYC**, **AML**, **Documents (IDP)**, **KYB** or **Liveness**.
4. Overdue cases come first, then high priority, then the nearest due date. Click the customer's name to open the case.

![Reviews queue on All open, with the Daniel Kipruto Langat PEP case and the Viktor Petrovich Orlov sanctions case](/help/shots/b11-queue.png)

### Take the case

1. In the **Decision** card, click **Take it**. The case moves to your **Assigned to me** view.
2. A Reviewer or Admin can instead choose a person from the **Assigned to** list. That person gets a "Case assigned to you" alert.
3. To hand the case back, click **Release**.

If your Admin chose **Automatic (share evenly)** in **Settings** → **Review workflow** → **Assignment**, new cases arrive already assigned. Each one goes to the person with the fewest open cases in that queue.

### Read the evidence

1. Read the reason at the top of the case, with when it opened, when it is due, and who ran the check.
2. Check the **Hits** card: the listed name, the list, the category, the PEP class, the match score and the risk level. For a document case, check the **Document flags** card.
3. Click **Open the full report** to see the whole check. See [B9 Reading a report and its PDF](/help/b9).

### Use the AI hit review (AML cases)

On an AML case with hits, Sentinel's AI compares the customer with each hit (date of birth, nationality, ID number, positions held, the news story) and recommends what to do. It runs by itself when the case opens, unless an Admin turned off **Review hits with AI when a case opens** in **Settings** → **Screening rules**.

1. Find the **AI hit review** card. If it says "Not run for this case yet.", click **Review the hits with AI**. To repeat it, click **Run again**.
2. Read the recommendation, the confidence and the summary. Under each hit you see **Different person**, **Same person** or **Unclear**, with the reasons. Lines that start "To settle it:" tell you what extra information would decide that hit.
3. If you agree, click **Use this recommendation in my decision**. This fills in the decision and notes below. You still choose the reason, and nothing is submitted until you click the button.

![AI hit review on the Daniel Kipruto Langat PEP case](/help/shots/b11-ai-review.png)

The AI only recommends. You make the decision. ID numbers are compared by Sentinel itself and are never sent to the AI.

### Make your decision

1. In the decision form, choose **Approve (clear the flag)** or **Reject**.
2. Choose a **Reason** from your organization's list, for example "False positive: different person or entity" or "PEP: risk outside appetite". A reason is required unless your Admin turned off **Require a reason for every decision**.
3. In **Notes**, write what you checked and why. Notes are kept in the audit log, up to 2,000 characters. A rejection needs a reason or a note.
4. Click the button at the bottom of the form:
   - **Approve case** or **Reject case** when your decision is final.
   - **Send recommendation** when the case needs a second person. The form tells you this with "This case needs a second person, so your decision is sent to someone with clearance to approve."

![Decision form on a PEP case, showing Your recommendation and the Send recommendation button](/help/shots/b11-decision.png)

### Approve or send back a recommendation (four-eyes)

When someone sends a recommendation, everyone who can approve it gets an "Approval needed" alert. The recommender and, under maker-checker, the person who ran the check, are left out.

1. Open **Awaiting my approval** and click the case. A box shows, for example, "Amina Hassan recommends: Approve", with the reason and notes.
2. The form is headed **Final decision (second approval)**. Choose the reason, add notes, and click **Approve case** or **Reject case**. You don't have to agree with the recommendation.
3. If the work isn't finished, click **Send recommendation back** and say why. The case returns to the recommender and goes back to the open queue.

![Case with a recommendation from a team member, awaiting second approval](/help/shots/b11-four-eyes.png "TODO")

### Escalate

If a case needs a more senior decision, click **Escalate for a senior decision** and say why. The case becomes high priority. Its deadline moves to 24 hours from now, if that is sooner. Admins and Reviewers get a "Case escalated" alert. Escalating keeps the case with your team. It does not send the case to DeepTrack.

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| **Approved** | The flag was wrong and the check now passes. For AML, the cleared hits are remembered for this customer (see [B6 AML screening](/help/b6)) and no longer count towards their risk rating. | Nothing. Your systems get the usual webhook. |
| **Rejected** | The flag was right and the check stays rejected. | Follow your policy. If you suspect money laundering, see [B14 Filing an STR or SAR](/help/b14). |
| "... recommends approve" (in the queue) | A first person has recommended. The case waits for a second person. | A person with clearance approves it or sends it back. |
| **Overdue** (red) | The deadline has passed. The case is now high priority, and Admins and Reviewers were alerted once. | Decide it, or escalate it. |
| **· escalated** | Someone asked for a senior decision. | A Reviewer or Admin picks it up. |

The default deadlines are 24 hours for high priority and 72 hours for normal and low. A PEP in class 1 or 2 always opens as high priority. An Admin changes these in **Settings** → **Review workflow** → **Review deadlines** and **Settings** → **Screening rules**.

The AI hit review shows one of three recommendations:

- **Clear the hits**: every hit looks like a different person.
- **Confirm the match**: at least one hit looks like this customer.
- **Get more information**: the evidence doesn't settle it yet. You can't copy this one into your decision.

If any hit is judged the same person, the AI always recommends confirming. If a hit is unclear, or a sanctions hit is cleared only with low confidence, it never recommends clearing. An amber note says when this rule changed its answer.

## Common questions

### Does deciding a case cost credits?

No. A check is charged once, whether it passed by itself or went through review. The AI hit review has no charge.

### Why can't I make the final decision?

The message under the form tells you why. You may be below the clearance for this category, the case may need four-eyes approval, or you may have run the check yourself. Send a recommendation instead.

### Can I approve my own recommendation?

No. A second person, with clearance for that category, must approve it.

### Can I undo a decision?

No. A closed case can't be reopened in Reviews. To challenge the result, a team member can dispute it with DeepTrack within 90 days. See [B15 Disputes](/help/b15).

### Who sees my notes, and how long are they kept?

Everyone on your team who can open Reviews, including Viewer / Auditor. Decisions and reasons are written to the audit log, which is never cleared. The notes stay on the case until your Admins remove data older than your retention period, seven years by default (**Settings** → **Audit & data**).

### What happens to a case my team disputed?

It shows in the queue, but DeepTrack's review team decides it. Your team can't decide it. See [B15 Disputes](/help/b15).

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B14 Filing an STR or SAR](/help/b14)
- [B15 Disputes](/help/b15)
- [A8 Review rules](/help/a8)
- [A9 Notifications](/help/a9)
