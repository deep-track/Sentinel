---
id: b13
title: Transaction monitoring
summary: Upload your customers' transactions, understand the seven rules that raise alerts, and close or escalate each alert with a recorded reason.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

Transaction monitoring checks your customers' transactions for patterns that can point to money laundering. You send the transactions, as a CSV file on the **Transactions** page or through the API. Sentinel looks at each customer's history, screens the counterparties (the people and businesses on the other side of each payment), and raises an alert when a rule is met.

Your team then opens each alert, looks at the transactions behind it, and decides. Either the activity has an innocent explanation and you close the alert, or it is suspicious and you escalate it. An escalated alert is usually followed by a suspicious transaction report to the FRC (Financial Reporting Centre). That is covered in B14.

Transaction monitoring does not use credits.

## Who can use it

| Task | Who can do it |
|---|---|
| See the **Transactions** page and open alerts | Admin, Reviewer, Analyst, Developer, Viewer / Auditor |
| Upload a CSV of transactions | Admin, Reviewer, Analyst, Developer |
| Close or escalate an alert | Admin, Reviewer, Analyst |
| Prepare an STR from an alert | Admin, Reviewer |
| Change the rule thresholds (Settings → Screening) | Admin |

Developers usually send transactions through the API (see C5). Viewers / Auditors can read every alert and its decision but cannot change anything.

## Step by step

### Upload transactions

1. In the side menu, click **Transactions**.
2. Under **Upload transactions**, click **Template** to download the CSV template.
3. Fill in one row per transaction. The columns are:

   | Column | What to put in it |
   |---|---|
   | externalId | Your own unique ID for the transaction, for example an M-Pesa receipt number. Required. |
   | customerRef | Your customer ID, or the Sentinel reference of the customer's KYC or AML check. Required. |
   | occurredAt | Date and time, for example 2026-10-16T09:30:00+03:00. Not in the future. |
   | amount | A positive number, for example 150000. |
   | currency | KES or USD. Blank means KES. |
   | direction | in or out. |
   | channel | mpesa, cash, bank_transfer, rtgs, swift, card, cheque or other. Blank means other. |
   | counterpartyName | Who paid or was paid. Optional, but needed for counterparty screening. |
   | counterpartyCountry | Two-letter country code, for example KE or AE. Optional. |
   | counterpartyAccount | Phone number, till or account number. Optional. |
   | narration | Your description. Optional. |

4. Click **Choose CSV** and pick your file. Large files are sent in batches of 500 for you.
5. Read the summary under the buttons: how many were added, how many were already uploaded, and how many were rejected. Each rejected row shows its row number in the file and the reason, for example "direction must be in or out". Fix those rows and upload the file again. Rows already accepted are skipped, because Sentinel ignores an externalId it has seen before.

![Upload summary with added, already uploaded and rejected counts](/help/shots/b13-upload-summary.png)

New alerts appear within a minute.

Tip: use the Sentinel reference of the customer's KYC or AML check as the customerRef where you can. Sentinel then knows the customer's risk rating, watches high-risk customers more closely, and links the alert to the check, which you need to prepare an STR from the alert.

### Work through the alert list

1. On the **Transactions** page, the **Alerts** list shows how many alerts are open.
2. Click **Open**, **Escalated** or **Closed** to switch between alerts in each state.
3. Each row shows the rule, the customer reference, a one-line summary, the severity, the number of transactions and the date raised. Click a row to open the alert.

![Transactions page with the open alerts for Demo Bank Ltd](/help/shots/b13-alerts-list.png)

### Read an alert

The alert page shows:

- The rule as the heading, with a **High** or **Medium** severity badge and the status.
- The summary, for example "3 cash or M-Pesa transactions just under the reporting threshold within 7 days (KES 5,550,000 in total)."
- The customer reference and when the alert was raised. If the reference matches a Sentinel check, click **Open the customer's check** to see who the customer is and their screening results.
- A table of the transactions behind the alert: **Date**, **Reference**, **In / out**, **Channel**, **Amount** and **Counterparty**, with totals in and out underneath.

![Alert page for a counterparty on a sanctions list](/help/shots/b13-alert-page.png)

### Close or escalate the alert

1. Look into the activity: the customer's check, their stated occupation or business, and any source of funds documents you hold.
2. In the **Decision** box, write what you checked and why you decided. At least 10 characters, at most 2,000.
3. Click **Close: not suspicious** if the activity is explained, or **Escalate as suspicious** if it is not.

The decision, your notes, your name and the time are saved on the alert and in the audit log. The alert moves to the **Closed** or **Escalated** list.

![An escalated alert with the decision notes](/help/shots/b13-escalated.png)

If you escalated it, prepare the report. When the customer reference matches a Sentinel check, Admins and Reviewers see the **Suspicious transaction report** panel at the bottom of the alert page (see B14). When it does not, prepare the STR from a review case on the customer's KYC or AML check instead (see B11 and B14).

## What each result means

### The seven rules

Amounts are compared in US dollars. KES amounts are converted at the rate DeepTrack sets. The defaults below can be changed by an Admin in **Settings → Screening**, under **Transaction monitoring**.

| Rule (as shown) | When it is raised (defaults) | Severity |
|---|---|---|
| Large cash transaction | One cash transaction of US$15,000 or more. M-Pesa is not cash. The threshold can be lowered but not raised above US$15,000, the reporting threshold set by law. | Medium |
| Possible structuring | 3 or more cash or M-Pesa transactions within 7 days, each between 70% of the cash threshold and the threshold, adding up to at least the threshold. Structuring means splitting money into smaller amounts to stay under the reporting threshold. | High |
| Unusual activity for this customer | Once the customer has 30 days of history: the last 24 hours add up to at least 5 times their usual daily volume, and at least US$5,000. | Medium |
| High-risk country | A counterparty in a country on the FATF call-for-action list, at any amount (High), or under FATF increased monitoring, from US$1,000 (Medium). Your home country never counts. | High or Medium |
| Money in and straight out | Money going out is at least 90% of the money that came in within 48 hours, with at least US$10,000 coming in. This is typical of mule accounts (accounts used to move other people's money). | High |
| Dormant account reactivated | A transaction of at least US$5,000 after 180 days with no activity. | Medium |
| Counterparty on a sanctions or watch list | The counterparty's name matches (High) or may match (Medium) a sanctions, PEP or Kenyan risk list. Every customer who dealt with that counterparty gets an alert. | High or Medium |

For customers your organization rates high risk or prohibited, the minimums for unusual activity, money in and straight out, and dormant accounts are halved, and so is the unusual activity multiple (never below 2). The large cash threshold stays the same. This works only when the customerRef is a Sentinel check reference.

The FATF country lists are kept up to date by DeepTrack's review team. Counterparty names are screened without an adverse media search, and each name's result is reused for 30 days.

### Alert status

| Status | Meaning | What to do |
|---|---|---|
| Open | Nobody has decided yet. | Investigate and decide. |
| Closed | Closed as not suspicious, with notes. | Nothing. The record stays for audit. |
| Escalated | Escalated as suspicious, with notes. | Prepare and file an STR (B14). |

## Common questions

### Can I undo a decision?

No. Once an alert is closed or escalated it cannot be reopened or changed. Write your notes with care, because auditors will read them.

### Why was my KES row rejected with "No USD to KES rate is set"?

The rules work in US dollars, so KES amounts need an exchange rate. Contact DeepTrack's review team to have it set, then upload the same file again.

### Can I lower the thresholds for my organization?

Yes. An Admin can change every threshold in **Settings → Screening**, under **Transaction monitoring**. The large cash threshold can only be set between US$1,000 and US$15,000.

### Will I be told when a new alert is raised?

Yes. By default, Admins, Reviewers and Analysts get a "Transaction alerts" notification, in the app and by email. An Admin can change who receives it in **Settings → Notifications**.

### What if the customer has no Sentinel check?

The rules still run on your own customer IDs. You will not get the stricter thresholds for high-risk customers, and you cannot prepare the STR from the alert page. Prepare it from a review case on the customer's KYC or AML check instead.

### How long are transactions kept?

For your organization's retention period, at least 7 years. When an Admin removes data past that period, old transactions are deleted. Transactions on an open alert are kept until the alert is decided. A decided alert whose transactions are all removed keeps a short record of the rule, severity and decision.

## Related chapters

- [B6 AML screening](/help/b6)
- [B11 Deciding a review case](/help/b11)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B14 Filing an STR or SAR](/help/b14)
- [A7 Screening rules](/help/a7)
- [C5 Transactions API](/help/c5)
