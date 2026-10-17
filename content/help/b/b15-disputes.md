---
id: b15
title: Disputes
summary: Dispute a pass or rejection you believe is wrong, follow it on the Disputes page, and read DeepTrack's decision.
roles: Admin, Reviewer, Analyst, Viewer / Auditor
---

## What it's for

Sometimes a check finishes with a result your team believes is wrong. A forged document may have passed, or a genuine customer may have been rejected. A dispute asks DeepTrack's review team to look at the result again.

A dispute is different from a review case. Your own team decides review cases on the **Reviews** page (see [B11 Deciding a review case](/help/b11)). DeepTrack's review team decides a dispute, and your team can't decide it.

The current result stays in place until DeepTrack decides.

## Who can use it

- **Admin**, **Reviewer** and **Analyst** can dispute a result and withdraw a dispute.
- **Viewer / Auditor** can open the **Disputes** page and see disputes, but can't send or withdraw one.
- **Developer** can't use disputes.

## Step by step

### Check that the result can be disputed

The **Dispute this result** button only shows when all of these are true:

- The check has finished with a pass or a rejection. A check that is still waiting for review is decided in **Reviews**, not disputed.
- The check finished no more than 90 days ago.
- The check has no open review case and isn't already disputed.

Your organization can have up to 50 open disputes at a time. If you reach that limit, Sentinel won't send a new one until DeepTrack decides some.

### Send a dispute

1. Open the check's report. You can dispute identity (KYC), business (KYB), document (IDP) and AML screening results.
2. Click **Dispute this result** at the top of the report.
3. The **Dispute this result** window tells you the current result and the one you are asking for. Sentinel fills in the opposite of the current result: if the check passed, you are asking for a rejection, and the other way round.
4. In **Why is the result wrong?**, explain what you know that the check didn't. Use at least 10 characters and no more than 2,000. Give facts DeepTrack can verify, for example "The customer was verified in person at our Westlands branch on the same day."
5. Click **Send dispute**. You see "Dispute sent to DeepTrack".

![The Dispute this result window on the Samuel Cheruiyot KYC check](/help/shots/b15-dispute-dialog.png)

The report now shows a banner: "Disputed: DeepTrack is reviewing this result." with a **See disputes** link.

![Disputed banner on the James Mutua report, with the Withdraw button](/help/shots/b15-disputed-banner.png)

### Follow your disputes

1. Click **Disputes** in the sidebar.
2. The top line shows how many disputes are open and how many are closed. Open disputes are listed first.
3. Each dispute shows the customer, the check reference, the date you disputed it, the result and the result you expected, and your reason. Click the customer's name to open the report.

![Disputes page with the James Mutua dispute marked With DeepTrack](/help/shots/b15-disputes-page.png)

The dispute also shows in **Reviews** as a high-priority case. When you open it, the case says "Your team disputed this result. DeepTrack decides it, and you'll be notified."

### Withdraw a dispute

You can withdraw a dispute until DeepTrack decides it, for example after the customer brings new documents.

1. Open the check's report.
2. In the "Disputed" banner, click **Withdraw**.
3. Confirm. The current result stays, and the dispute shows as **Withdrawn**.

### What DeepTrack does

DeepTrack's review team treats every dispute as high priority. A reviewer looks at the check, its evidence and your reason. They then change the result or keep it, and write a note explaining why.

When the dispute is decided:

- If the result changes, the check's report shows the new result.
- If an AML screening changes to a pass, its hits are remembered as cleared for that customer, the same as when your team approves a case.
- Your systems receive the usual webhook for a decided review.

### How you hear back

Sentinel sends a "Dispute decided" notification to the in-app inbox (the bell) and by email. By default it goes to every Admin, Reviewer and Analyst. The title says either "Dispute upheld" or "Dispute not upheld", with the check reference. The message gives the old and new result, or says the result stays, followed by DeepTrack's note. Click it to open the **Disputes** page.

An Admin can change who gets this notification, or turn the email off, in **Settings** → **Notifications** → **Dispute decided**. See [A9 Notifications](/help/a9).

## What each result means

| Status | What it means | What to do |
|---|---|---|
| **With DeepTrack** | DeepTrack's review team hasn't decided yet. The current result stands. | Wait, or withdraw it if it's no longer needed. Don't act on the customer as if the result has changed. |
| **Upheld** | DeepTrack agreed and changed the result. The line "Decided by ... final result ..." shows the new result and the note. | Update the customer's record in your own systems if the webhook doesn't do it for you. |
| **Not upheld** | DeepTrack kept the original result. The note explains why. | Follow your policy for that result. If you have new evidence, run a new check. |
| **Withdrawn** | Your team withdrew the dispute. The original result stands. | Nothing. |

## Common questions

### Does a dispute cost credits?

No. The check was charged when it ran, and DeepTrack's decision doesn't charge it again.

### How long does DeepTrack take?

Disputes are treated as high priority. You get a notification as soon as DeepTrack decides, so you don't need to keep checking the page.

### Why don't I see the Dispute this result button?

The check may still be waiting for review, may be older than 90 days, may have an open case, or may already be disputed. Your role may also not allow disputes. Only Admins, Reviewers and Analysts can dispute.

### Can my team decide a disputed case in Reviews?

No. The case shows in the queue so you can see it, but only DeepTrack's review team can decide it. You can withdraw the dispute instead.

### Can I dispute the same result twice?

Not while a dispute is open. After a dispute is decided or withdrawn, you can send a new one, as long as the check finished no more than 90 days ago.

### Is the dispute kept on record?

Yes. Sending, withdrawing and DeepTrack's decision are all recorded in the check's history and your audit log.

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B6 AML screening](/help/b6)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [A9 Notifications](/help/a9)
