---
id: a11
title: Data retention and data requests
summary: Set how long Sentinel keeps customer records, remove old personal data with a second Admin's approval, and answer customers' data requests.
roles: Admin
---

## What it's for

Two laws pull in different directions. Kenya's Proceeds of Crime and Anti-Money Laundering Act (POCAMLA) says you must keep customer due diligence records for at least seven years. The Kenya Data Protection Act says you must not keep personal data longer than you need it.

Sentinel helps you do both:

- You set a **retention period**: how long Sentinel keeps the checks and transactions your team runs. It can't be shorter than seven years.
- Sentinel never deletes records on its own. When records pass the retention period, one Admin asks to remove them and a second person approves. This is two-person (four-eyes) approval, so no one can delete customer data alone.
- When a customer asks to see, correct or delete their data, you use what Sentinel keeps to answer them.

## Who can use it

- Only an **Admin** sees the **Data retention** section. Other roles see the audit log on the same tab, but not this section.
- An **Admin** changes the retention period, requests a removal, approves another Admin's request, or cancels a request.
- The Admin who requested a removal can't approve it. A second Admin approves it, or DeepTrack does if you have only one Admin.

## Step by step

### Set the retention period

1. Click **Settings** in the sidebar, then the **Audit & data** tab.
2. Scroll past the audit log to **Data retention**.
3. In **Keep records for (months)**, type the number of months. The default is 84 months (seven years), the shortest Sentinel allows. The longest is 240 months (20 years).
4. Click **Save changes**.

Under the field, Sentinel tells you how many checks and transactions are older than the cutoff date, for example "No checks or transactions are past the retention period."

![Data retention section for Demo Bank Ltd, set to 84 months, with nothing past the retention period](/help/shots/a11-retention.png "TODO")

### Request removal of old records

1. When records are past the period, the section shows how many, and the cutoff date. Click **Request removal**.
2. Read the message and confirm. Nothing is deleted yet.
3. The section now shows **Removal waiting for approval**, with your name, the date and how many checks and transactions it covers. You see "You asked for this removal, so someone else must approve it."
4. Tell your second Admin that the request is waiting.

Only one removal can wait or run at a time.

![Removal waiting for approval, requested by one Admin](/help/shots/a11-pending.png "TODO")

### Approve or cancel a removal

1. As the second Admin, open **Settings** → **Audit & data** and find **Removal waiting for approval**.
2. Check the cutoff date and the counts with your compliance officer.
3. Click **Approve removal** and confirm. The personal data is deleted and can't be recovered.
4. Sentinel removes the data in the background. While it runs, you see "Removing personal data", with the number of checks done so far.
5. To stop a request before it is approved, click **Cancel**. Either Admin can cancel.

When the removal finishes, it appears under **Removal history**, with who requested it, who approved it, and what was kept.

![Removal history with one completed removal and the checks kept](/help/shots/a11-history.png "TODO")

### Answer a customer's data request

Under the Data Protection Act, a customer can ask to see their data, correct it, have it deleted, or object to its use. Your organization receives and answers these requests. Sentinel doesn't have a screen for logging them.

1. **To see their data (access):** find the customer's checks on the page for each kind of check, for example **Identity (KYC)** or **AML Screening**. Open each check and download its report. See [B9 Reading a report and its PDF](/help/b9).
2. **To correct their data:** run a new check with the correct details. A finished check isn't edited.
3. **To delete their data:** checks inside the retention period are kept, because POCAMLA requires it. Checks past the period are deleted by a removal, as above.
4. If you need DeepTrack to act on a specific record, contact DeepTrack. DeepTrack's review team logs your request and tracks it to a deadline.

## What each result means

### What a removal deletes and keeps

| Record | What happens |
|---|---|
| A check created before the cutoff | Its personal data is removed: the details entered, the result, links to uploaded documents, AML hits, directors, registry lookups, face templates and webhook copies. A minimal record stays: the reference, type, verdict, credits and dates. |
| A review case on that check | The case stays for your statistics, without its notes. Its reason reads "Removed after the retention period." |
| A transaction from before the cutoff | Deleted. |
| An alert whose transactions were all deleted | If decided, it keeps a minimal record: the rule, severity, decision, who and when. |
| A counterparty screening last run before the cutoff | Deleted. |
| The audit log and your credit history | Kept. They hold no customer documents. |

### Records that are kept for now

Some old records are held back. The history line starts "Kept:" and says why.

| Reason | What to do |
|---|---|
| with an open case or dispute | Decide the case, or wait for the dispute. The next removal picks it up. |
| under active monitoring | The customer is still a customer. Stop monitoring when the relationship ends. See [B7 Ongoing monitoring](/help/b7). |
| with an STR | A check reported to the FRC is kept. |
| not finished | The check never completed. |
| on open alerts (transactions) | Decide the alert. See [B13 Transaction monitoring](/help/b13). |

## Common questions

### Can I set the period shorter than seven years?

No. POCAMLA requires at least seven years, so Sentinel refuses anything under 84 months.

### Does Sentinel delete records automatically when they reach the period?

No. An Admin must request removal and a second person must approve it.

### What if I lengthen the period after a removal was approved?

The longer period wins. Sentinel removes only records older than the new cutoff.

### Can I undo a removal?

No. Once approved, the personal data is gone. You can cancel only while it is waiting for approval.

### Is the removal recorded?

Yes. The request, the approval or cancellation, and the finished removal each appear in the audit log, as do changes to the retention period. See [A10 The audit log](/help/a10).

### Does it cost credits?

No. Changing the period and removing records are free.

## Related chapters

- [A4 Your organization profile](/help/a4)
- [A5 Team members and roles](/help/a5)
- [A10 The audit log](/help/a10)
- [B7 Ongoing monitoring](/help/b7)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B13 Transaction monitoring](/help/b13)
- [B14 Filing an STR or SAR](/help/b14)
