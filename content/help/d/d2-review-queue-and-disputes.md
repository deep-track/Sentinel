---
id: d2
title: Review queue and disputes
summary: Work the cross-client review queue, decide client disputes with a certainty score and notes, and manage reviewer workload and deadlines.
roles: Internal admin, Internal reviewer
---

## What it's for

Every check that can't be decided automatically, and every result a client disputes, becomes an item in one review queue shared by all clients. The **Review queue** is where DeepTrack's review team reads those items and decides them. **Review operations** shows who is working on what, which items are late, and how often reviewers overturn the automation.

There are three kinds of item:

- **Client dispute**: a client's team believes a pass or rejection is wrong (see [B15 Disputes](/help/b15)). Only DeepTrack can decide it. The client's team can only withdraw it.
- **Auto-escalation**: the automation held the check, for example a sanctions or PEP hit, a face mismatch or a failed registry lookup.
- **Internal flag**: a check flagged by Sentinel's own rules, for example some KYB and identity checks.

Auto-escalations and internal flags also show on the client's own **Reviews** page, and the client's team usually decides them there (see [B11 Deciding a review case](/help/b11)). Whoever decides first closes the item.

## Who can use it

| Screen | Who can view | Who can act |
|---|---|---|
| **Review queue** and its case page | Internal admins and internal reviewers, including view-only | Internal admins and internal reviewers without the view-only modifier can resolve or escalate. |
| **Review operations** | Internal admins and internal reviewers, including view-only | Internal reviewers and admins without view-only can take an unassigned item or release their own. Only internal admins can **Take over** another reviewer's item or assign it to someone. |

With view-only, the queue header says "read only", rows show **View result**, and the case page says "Read-only access: an internal reviewer or admin without the view-only role can resolve review items."

## Step by step

### Work the queue

1. In the Back Office menu, under **Reviews**, click **Review queue**.
2. Read the tiles: **Pending**, **Escalated / in review**, **High priority** and **Oldest open item**.
3. The **Open** tab lists client disputes first, then auto-escalations, then internal flags, oldest first within each.
4. Click **Review** on the row you want. Use the **Resolved** tab to read past decisions, most recent first.

![Review queue on the Open tab with the James Mutua dispute at the top](/help/shots/d2-queue.png)

### Read the case

1. **Review item** shows the client, the trigger, the priority and status, when it opened and the **Trigger reason**. For a dispute, the reason starts with the current and expected result, for example "Client dispute (reject → pass expected)".
2. **Verification result** shows the type, reference, **Automated verdict** and **Confidence**. For a dispute, **Client dispute** shows the client's own words.
3. For AML checks, read **Watchlist coverage**. "incomplete at screening time" means a list was missing or stale when the check ran, so a "no hits" result can't be trusted on its own.
4. Read **Watchlist matches**: entity, category, source, score, method, country and risk.
5. If you need more, open **Raw record** and click **Show JSON**. Photos and videos are left out.
6. Click the client's name to open their account on **Client accounts**.

### Decide a dispute

1. In **Notes (audit trail)**, write what you checked and why. Notes are required for every dispute decision, up to 2,000 characters.
2. Write the note for the client. The first 500 characters are sent to the client's team in their "Dispute upheld" or "Dispute not upheld" notification. For example: "The selfie shows signs of a synthetic face. The in-branch visit doesn't change the result of this check. Run a new check with a live selfie."
3. In **Certainty %**, enter how sure you are, from 80 to 100.
4. Click one button:
   - **Final: pass**: the check passes.
   - **Final: reject**: the check is rejected.
   - **Escalate**: you can't decide on the evidence. The item stays open.
5. Confirm in the browser window. You see "Resolved — final verdict pass." (or reject), or "Escalated. The item stays open."

The dispute is "upheld" when the result changes and "not upheld" when it stays.

![Resolve panel on the James Mutua dispute, showing Final: pass, Final: reject and Escalate](/help/shots/d2-dispute-resolve.png)

### Decide any other item

1. Write **Notes (audit trail)**. They are required for **Keep verdict** and **Escalate**.
2. Enter **Certainty %** from 80 to 100 for **Confirm** or **Keep verdict**.
3. Click **Confirm** (the automated flag was wrong, the check passes), **Keep verdict** (the flag was right, the check is rejected) or **Escalate**.

Your decision is final. It does not go through the client's own workflow rules, such as four-eyes approval or who may clear sanctions hits. If the client's team has already decided the item, you see "This item was already resolved."

### Certainty below 80%

Never confirm or keep a verdict when you are less than 80% sure. Sentinel refuses it with "Certainty must be between 80 and 100% ... escalate instead." Escalate, and say in the notes what evidence is missing.

Escalating doesn't notify anyone. The item shows **escalated**, your note shows as **Escalation notes**, and it stays in the queue until someone resolves it.

### What a decision does

- The check's verdict changes to pass or reject, and the client's systems get the usual webhook.
- An AML pass remembers the hits as cleared for that customer, and the customer's risk rating is recalculated. A KYB pass is also re-rated.
- The fraud network records the outcome, so a rejection for fraud flags the same identifiers in later checks.
- The check is charged once, if it wasn't charged already. A dispute is never charged twice.
- The decision, notes and certainty go to the audit log. When you overturn the automation, the decision is also saved as a training label for the models.

### Manage workload in Review operations

1. Under **Reviews**, click **Review operations**. The top bar shows the deadlines: high 4h, normal 24h, low 72h from when the item opened.
2. Read the tiles: **Open items** (with how many are unassigned), **Past deadline**, **Resolved on time** (last 30 days) and **Overturn rate** (last 90 days).
3. In **Open items**, past-deadline items come first. Click **Assign to me** to take an item, or **Unassign** to release it. An internal admin can also click **Take over**, or pick a person from **Assign…**.
4. Check **Reviewer workload**, **Turnaround by priority**, **Why items are held** and **Overturn rate by type**.

Assignment shows who is working an item. It doesn't stop anyone else from resolving it.

![Review operations with Open items, Reviewer workload and Why items are held](/help/shots/d2-review-ops.png)

These deadlines are DeepTrack's. Each client also has its own case deadlines (by default 24 hours for high priority). When a client's deadline passes, Sentinel raises the item to high priority and sends the client's team a "Missed review deadline" alert. This includes disputes, so a dispute left for more than 24 hours alerts the client.

### Recurring tasks

- [ ] Daily: Decide every client dispute within 4 hours of it opening.
- [ ] Daily: Clear **Past deadline** on Review operations, and assign every unassigned high-priority item.
- [ ] Daily: Check escalated items and make sure someone owns each one.
- [ ] Weekly: Read **Why items are held**. A rise in **Service outage** means a provider or watchlist problem, not a risky customer.
- [ ] Weekly: Spot-check five resolved items for clear notes and a sensible certainty.
- [ ] Monthly: Review **Overturn rate by type** with the product team. Above 20% shows amber and suggests the automation is drifting.

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| **P1** / **P2** / **P3** | High, normal or low priority. Disputes are always P1. | Work P1 first. |
| **pending** | Nobody has acted on it. | Pick it up. |
| **in review** / **escalated** | Escalated with notes, still open. | Read the escalation notes, then decide. |
| **resolved** | Decided, or withdrawn by the client. | Nothing. |
| **Confirmed (pass)** | Resolved as pass. | Nothing. |
| **Kept verdict (reject)** | Resolved as reject. | Nothing. |
| "Verification missing" | The check behind the item was deleted. | It can't be resolved. Tell engineering. |
| Red "... late" in **Due** | Past DeepTrack's deadline. | Resolve or reassign now. |
| **Service outage** hold reason | Held because a service or list was down or stale. | Check **Service health** before deciding. |

## Common questions

### Can I decide a dispute I raised doubts about earlier?

Yes. Anyone with an internal role and no view-only modifier can resolve any open item, including one they escalated. Your new note replaces the escalation note.

### Does the client see my notes?

On a dispute, yes: the first 500 characters go into their notification, and the full note shows as the outcome on their **Disputes** page with your name. On other items, your notes stay in the audit log.

### Can I undo a decision?

No. A resolved item can't be reopened here. If the result was wrong, the client can dispute it again within 90 days of the check finishing.

### What if the client withdraws while I'm reviewing?

The item closes as resolved. When you click a button you see "This item was already resolved."

### Who appears in Reviewer workload?

Anyone with an assigned open item, or who resolved an item in the last 30 days.

### Why does Overturn rate matter?

It shows how often reviewers correct the automation. A rising rate for one check type means its rules or models need attention.

## Related chapters

- [D1 The Back Office at a glance](/internal-ops/help/d1)
- [B15 Disputes](/help/b15)
- [B11 Deciding a review case](/help/b11)
- [B6 AML screening](/help/b6)
- [B10 Fraud signals explained](/help/b10)
- [A9 Notifications](/help/a9)
