---
id: b14
title: Filing an STR or SAR
summary: Prepare a suspicious transaction or activity report as a goAML file for the FRC, submit it, and record the FRC reference in Sentinel.
roles: Admin, Reviewer
---

## What it's for

When you suspect money laundering or terrorist financing, the law requires you to report it to the FRC (Financial Reporting Centre), which takes reports through goAML. There are two kinds:

- An STR (suspicious transaction report) is about a specific transaction, such as a cash deposit or an M-Pesa transfer.
- A SAR (suspicious activity report) is about activity with no single transaction, for example a sanctioned person trying to open an account.

Sentinel builds a goAML XML draft from the case or alert, your organization profile and the customer's check. You check the file, complete anything it needs, and submit it in goAML yourself. Sentinel never sends anything to the FRC. When goAML gives you a reference, you record it in Sentinel. Sentinel keeps a register of every report you prepared.

Preparing a report does not use credits.

## Who can use it

Only **Admins** and **Reviewers** can prepare reports, download the goAML file, mark a report submitted and see the STR register. Reports are confidential, so Analysts, Developers and Viewers / Auditors do not see them. Viewers / Auditors see only the number prepared and submitted, in the monthly report pack.

Never tell the customer that you are reporting them. That is tipping-off, an offence under Kenyan law.

## Step by step

### Before your first report

An Admin must fill in two fields in **Settings → Organization** (see A4):

- **goAML reporting entity ID**: the ID the FRC gave you when you registered on goAML.
- **Compliance contact**: the name of your MLRO (money laundering reporting officer). This person is the reporting person on every report.

Sentinel will not prepare a report without them. Also fill in **Compliance contact email**, **Compliance contact phone**, **goAML branch (optional)** and your address and city, because they go into the file too.

### Open the report panel

You can prepare a report from two places:

- **A review case.** Open the case from **Reviews** (see B11). The **Suspicious transaction report** panel is below the decision area.
- **A transaction alert.** Open the alert from **Transactions** (see B13). The panel is at the bottom of the page. It appears only when the alert's customer reference is the Sentinel reference of a KYC or AML check, because the report needs the customer's details from that check.

![Suspicious transaction report panel on an escalated structuring alert](/help/shots/b14-panel.png)

### Prepare the report

1. In the **Suspicious transaction report** panel, click **Prepare STR**. The **Prepare a report for the FRC** window opens.
2. Choose **SAR** or **STR**. From a review case, SAR is selected. From a transaction alert, STR is selected.
3. Check **Reason for suspicion**. Sentinel fills it in for you:
   - From a review case: the case type, the customer, the check result and up to five screening hits.
   - From an alert: the rule and the alert summary.

   Rewrite it in your own words. Say what happened, why it does not fit the customer, and what you found out. Up to 4,000 characters.
4. Check **Action taken**, for example "Account placed under enhanced monitoring; customer asked for source of funds." Up to 1,000 characters.
5. Optionally, enter **Indicator codes (optional)** from the FRC's goAML indicator list, separated by commas. Up to 20 codes.
6. For an STR, fill in **The transaction**:
   - **Transaction number**: your reference for it, such as the M-Pesa receipt number.
   - **Transaction date**: in your own time zone.
   - **Amount (local currency)**.
   - **goAML transmode code (optional)**, for example the code for cash.
   - **Counterparty name (optional)** and **Counterparty account (optional)**.
   - **What the transaction was**, for example "Cash deposit, Upper Hill branch".

   From an alert, Sentinel fills these in from the alert's largest transaction. Check the amount: if that transaction was in US dollars and your local currency is KES, convert it.
7. Click **Prepare and download**. Sentinel saves the report as a draft, gives it a reference such as STR-20261016-A1B2C3, and downloads the file, for example `STR-20261016-A1B2C3-STR.xml`.

![Prepare a report for the FRC window with STR selected](/help/shots/b14-dialog.png)

### Submit it in goAML

1. Open the XML file and check it against the FRC's current goAML guidance. Add anything the FRC asks for that Sentinel did not fill in.
2. Upload it to goAML, or key it in there, and submit it.
3. goAML gives the report a reference. Keep it.

### Mark it submitted

1. Go back to the report panel on the case or alert, or to **Reports** and the **STR register**.
2. Next to the draft, click **Mark submitted**.
3. Enter the reference goAML gave you and confirm.

The report's status changes to submitted, with the FRC reference and the date.

![STR register on the Reports page with a draft and a submitted report](/help/shots/b14-register.png)

To download a report's file again, click **goAML XML** in the report panel, or **XML** in the STR register.

### What goes into the file

- Your organization: goAML reporting entity ID, branch, address and city, and the compliance contact as the reporting person (title MLRO), with their email and phone.
- The report type (STR or SAR), Sentinel's reference, the date prepared and your local currency (KES, or USD if your organization is billed in US dollars).
- The reason, the action taken and any indicator codes.
- The subject, taken from the customer's check. For a person: name, date of birth, ID number, nationality and country. For a business: name, registration number and country of incorporation.
- For an STR, the transaction, with your customer as the sender and the counterparty as the recipient.

## What each result means

| Status | Where you see it | Meaning | What to do |
|---|---|---|---|
| Draft | "draft, not yet submitted" in the panel; **Draft** in the register | Sentinel built the file. Nothing has gone to the FRC. | Check the file, submit it in goAML, then click **Mark submitted**. |
| Submitted | "submitted" with the FRC reference in the panel; **Submitted**, the date and the reference in the register | You recorded that the FRC received it. | Nothing more in Sentinel. Keep the case notes up to date. |

## Common questions

### Why do I get "Add your goAML reporting entity ID in Settings → Organization first"?

Your organization profile has no goAML reporting entity ID. Ask an Admin to add it in **Settings → Organization**. The same applies to the compliance contact.

### Can I edit or delete a report after preparing it?

No. Drafts cannot be edited or deleted. If you need to change something, prepare a new report from the same case or alert, and mark only the one you submitted. You can also edit the XML file itself before you submit it.

### Can I undo "Mark submitted"?

No. The FRC reference and date are saved for good and the audit log records who marked it. Enter the reference exactly as goAML shows it.

### Who can see the reason I wrote?

Only Admins and Reviewers in your organization. The audit log records only that a report was prepared or submitted, with its reference. Viewers / Auditors see only the counts in the monthly report pack, never the content.

### The customer's alert has no report panel. Why?

Either you are not an Admin or Reviewer, or the alert's customer reference is your own customer ID rather than a Sentinel check reference. In the second case, prepare the report from a review case on the customer's KYC or AML check (see B11).

### How long are reports kept?

Reports stay in the register. When old data is removed after the retention period, any check with an STR is kept, so the report's subject is never lost.

## Related chapters

- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B13 Transaction monitoring](/help/b13)
- [A4 Your organization profile](/help/a4)
