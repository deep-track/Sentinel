---
id: b7
title: Ongoing monitoring
summary: Enrol customers for regular re-screening, follow their monitoring alerts in Reviews, and stop monitoring when a relationship ends.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

A customer who was clear at onboarding may be sanctioned, appointed to public office or named in the news later. Ongoing monitoring screens your customers again on a schedule, so you hear about it.

When you enrol a customer, the hits from their first screening become the baseline. Each re-screening is compared with that baseline. You get an alert only when something changes for the worse:

- a **new hit** that wasn't there before, or
- a known hit that is **now more severe**: it gained a risk category, moved to a more senior PEP class (PEP: politically exposed person), or became a critical sanctions match.

Hits that disappear, for example when someone is delisted, never raise an alert. Sentinel records them in the audit log.

Monitoring uses the same sources and rules as a normal screening. See [B6 AML screening](/help/b6).

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Developer** can enrol customers and click **Stop monitoring**.
- **Viewer / Auditor** can see monitored subjects and alerts, but can't enrol or stop them.
- Alerts become review cases. **Admin**, **Reviewer** and **Analyst** work them under your clearance rules in **Settings** → **Review workflow**. See [B11 Deciding a review case](/help/b11).
- Only an **Admin** can change the monitoring settings in **Settings** → **Screening rules**.

## Step by step

### Enrol a customer

1. Click **AML Screening** in the sidebar.
2. Fill in the subject's details as for any screening. A date of birth or ID number cuts false alerts later.
3. Tick **Keep monitoring (re-screen daily, alert on new hits)**.
4. In **Customer reference**, type your own customer number, for example CUST-1001. It is optional but recommended.
5. Click **Run AML screening**. You see "Screening queued, and the subject will be re-screened daily."

If you screen a customer again with the same **Customer reference** and tick the box, Sentinel updates the existing monitored subject. It doesn't create a second one.

An Admin can turn on **Monitor every new AML screening by default** in **Settings** → **Screening rules** → **Ongoing monitoring**. Then every new screening is enrolled unless it says otherwise. Your developers can also enrol customers through the API ([C4](/help/c4)).

### Check who is monitored

1. On the **AML Screening** page, find the **Monitored subjects** panel.
2. Each row shows the name, your customer reference, when it was **Last screened**, the number of current hits and the number of alerts. A new subject shows "Waiting for the first screening".
3. Open the enrolment screening's report. Its **Ongoing monitoring** section shows the **Status**, **Monitored subject** reference, **Last screened**, **Next screening** and **Alerts raised**.

In Demo Bank Ltd, Daniel Kipruto Langat (customer reference CUST-PEP-01) is monitored, with one current hit and no alerts.

![Monitored subjects panel with Daniel Kipruto Langat](/help/shots/b7-monitored-subjects.png "TODO")

### Work a monitoring alert

1. You get a notification titled "Monitoring alert:" followed by the customer's name. By default it goes to Admins, Reviewers and Analysts, by email too.
2. Click **Reviews** in the sidebar, and choose **AML** in the **Queue** list. The alert is an open case.
3. Open the case, or open the alert's report from **Recent screenings** on the **AML Screening** page.
4. Read the **Ongoing monitoring alert** section first. **New hits** and **Hits now more severe** name exactly what changed. **Monitored subject** and **Customer reference** tell you which customer it is.
5. Read the matching cards under **Findings**, then decide the case as in [B11](/help/b11). If you clear it, those hits are remembered as cleared for this customer and aren't raised again unless they become more severe.

![Report with the Ongoing monitoring alert section](/help/shots/b7-alert-report.png "TODO")

If your organization uses webhooks, each alert is also sent as a separate monitoring alert event ([C4](/help/c4)).

### Stop monitoring

1. On the **AML Screening** page, find the customer under **Monitored subjects**.
2. Click **Stop monitoring**. It takes effect straight away, with no confirmation step.

The customer's past screenings and alerts stay in Sentinel. Their report now shows **Status** as **Stopped**.

## What each result means

| What you see | Where | What it means | What to do |
|---|---|---|---|
| **Waiting for the first screening** | Monitored subjects | The enrolment screening hasn't finished, or couldn't screen every list. | Nothing. It fills in after the next complete screening. |
| **Last screened** with "0 current hits" | Monitored subjects | The latest re-screening found nothing. | Nothing. |
| A number of current hits, no alerts | Monitored subjects | Hits from the baseline are still there. No change since. | Nothing, if the baseline hits were already reviewed. |
| A number of alerts | Monitored subjects | Re-screening found new or more severe hits that many times. | Check that each alert case is decided. |
| **Active — re-screened daily** | Report, Ongoing monitoring | The customer is being monitored. | Nothing. |
| **Stopped** | Report, Ongoing monitoring | Someone clicked **Stop monitoring**. | Enrol again if the relationship continues. |
| **Ongoing monitoring alert** | Report | This screening was raised by monitoring. Its verdict is at least **Needs review**. | Decide the review case. |

Customers are re-screened daily by default. An Admin can choose **Daily**, **Weekly** or **Monthly** in **Settings** → **Screening rules** → **Re-screen frequency**. The change applies to each customer from their next re-screening. The screens still say "daily" whichever you choose.

If a sanctions list or OpenSanctions can't be reached during a re-screening, Sentinel keeps the baseline, raises no alert and tries again about an hour later.

## Common questions

### Does monitoring cost extra?

No. Monitoring is included in the price of the screening that enrolled the customer. Re-screenings and alerts aren't charged.

### Will I be alerted again about a hit I already cleared?

No, as long as the hit hasn't become more severe. This needs a customer reference, ID number or date of birth on the subject, so Sentinel can tell this customer apart from others with the same name.

### Can I undo Stop monitoring?

Not directly. To start again, run a new screening with **Keep monitoring (re-screen daily, alert on new hits)** ticked. That screening is charged as usual and sets a new baseline.

### Who gets monitoring alert notifications?

By default, Admins, Reviewers and Analysts, in Sentinel and by email. An Admin changes this in **Settings** → **Notifications** under **Monitoring alert**.

### How many monitored customers can I see?

The **Monitored subjects** panel shows your 100 most recently enrolled customers. The **Customer risk** page lists up to 500, with their risk rating and review dates ([B12](/help/b12)).

### What happens when a customer is delisted?

The hit drops out of the customer's current hits, and Sentinel records the change in the audit log. You don't get an alert for it.

## Related chapters

- [B6 AML screening](/help/b6)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B13 Transaction monitoring](/help/b13)
- [A7 Screening rules](/help/a7)
- [C4 AML and monitoring API](/help/c4)
