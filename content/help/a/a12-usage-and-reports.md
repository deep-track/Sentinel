---
id: a12
title: Usage and reports
summary: See what your checks cost by service, produce the monthly AML/KYC compliance report as a PDF, and export your credit history.
roles: Admin, Reviewer, Viewer / Auditor
---

## What it's for

Your board, your auditors and your regulator (CBK, SASRA, CMA or IRA) will ask how much screening you did, what it found and how fast your team decided. Your finance team will ask what it cost. Sentinel answers both in two places:

- **Reports** holds the monthly compliance report: checks by product and outcome, AML hits, review cases and turnaround, and the number of STRs. You save it as a PDF.
- **Billing & Credits** holds the credit history: every check you were charged for, with its price, which you can export as a CSV file.

Opening reports and exporting do not use credits.

## Who can use it

| What | Admin | Reviewer | Analyst | Developer | Viewer / Auditor |
| --- | --- | --- | --- | --- | --- |
| Monthly compliance report | Yes | Yes | No | No | Yes |
| STR register on the Reports page | Yes | Yes | No | No | No |
| Credit history and CSV export | Yes | Yes | Yes | Yes | Yes |

Analysts and Developers who open **Reports** see **Reports are for Admins, Reviewers and Auditors.** The STR register is confidential, so a Viewer / Auditor sees only the number of reports prepared and submitted.

## Step by step

### Produce the monthly compliance report

1. Click **Reports** in the sidebar.
2. Choose the month in the month list at the top. The list holds the last 12 months, and last month is selected for you.
3. Read the report on screen. It has five parts, described below.
4. Click **Download (PDF)**. Your browser's print window opens.
5. Choose **Save as PDF** as the printer, and save the file, for example `Demo Bank - AML KYC report - September 2026.pdf`.

![Monthly AML / KYC compliance report for Demo Bank Ltd, current month selected](/help/shots/a12-monthly-report.png)

The header shows your organization's legal name, registration number, regulator, licence number and logo from **Settings → Organization** (see A4). Fill those in first so the PDF is ready to send. Months run from midnight on the 1st to midnight at month end, East Africa Time.

### What the report contains

**Checks.** Four figures:

- **Checks run**: all checks started in the month. Checks made with a test API key are left out.
- **AML screenings**: new screenings.
- **Monitoring alerts**: changes found by ongoing monitoring of customers you already screened (see B7).
- **Monitored customers**: how many customers are being monitored today, not at month end.

Below them, a table splits the checks by product, **KYC (identity)**, **AML screening**, **Documents (IDP)**, **Business (KYB)** and **Liveness**, with how many ended **Pass**, **Review**, **Reject** or **Failed**. Checks still running are counted in **Total** only.

**AML hits.** For each risk category, the number of screenings with at least one hit: **Sanctions & watchlists**, **Politically exposed person**, **Special interest person / entity**, **Fitness & probity**, **Adverse media** and **Insolvency**. Then the PEPs (politically exposed persons: people who hold or held a prominent public role) by their highest class, from Class 1 (national level) to Class 4 (family and close associates).

**Reviews.** Review cases (see B11):

- **Opened** and **Decided** in the month, with how many were approved and rejected.
- **Median time to decide**, and the time within which 90% were decided.
- **Open at month end**, and how many of those were past their deadline.
- How many your team decided and how many DeepTrack's review team decided, the number of four-eyes approvals (a second person approved the decision) and how many were decided late.
- **Decided by**: each person's approvals and rejections.
- **Reasons given**: how often each reason code was used.

**Suspicious transaction reports.** The number prepared and the number submitted to the FRC in the month. Counts only.

![Reviews section with decisions per person](/help/shots/a12-reviews-section.png)

### The STR register

Admins and Reviewers see the **STR register** below the report. It lists every STR and SAR you prepared, with the subject, who prepared it, and its status: **Draft**, or **Submitted** with the date and the FRC reference. Click **XML** to download the goAML file again, or **Mark submitted** to record the FRC reference. The register is not part of the PDF. See B14 for the full steps.

### See credit use by service

1. Click **Billing & Credits** in the sidebar.
2. Scroll to **Credit history**. Every credit added, charged, refunded or adjusted is listed, newest first.
3. Each **Charge** line shows the check's reference, which you can click to open the check, and a description with the credits and their value, for example:

```text
Charge  ver_3f9a1c07b2e84d56a0c4e19b7d3f2a68
IDP verification pass — 1 credit, KES 34.78 on business
```

4. Click **Load more** to see older lines.

The **Your prices** table above the history shows what each service costs on your plan. See A2.

### Export the credit history

1. On **Billing & Credits**, click **CSV (latest 100)** in the **Credit history** header.
2. A file named like `sentinel-credit-history-2026-10-16.csv` downloads.
3. Open it in Excel or Google Sheets. To total credit use by service, make a pivot table on the **Check type** column and sum **Credits**.

The file has these columns: **Date**, **Type**, **Credits**, **Amount (KES)** or **Amount (USD)**, **Scan ID**, **Check type** and **Description**. **Check type** uses these short codes:

| Code | Service |
| --- | --- |
| `idp` | KYC identity check (document and liveness) |
| `document` | Document or proof of address check |
| `aml` | AML screening and monitoring |
| `kyb` | Business (KYB) check |
| `liveness` | Liveness check |

![Credit history with the CSV (latest 100) button](/help/shots/a12-credit-history.png)

## What each result means

| Outcome in the report | What it means |
| --- | --- |
| **Pass** | The check passed with no issues. |
| **Review** | The check needed a person to look at it. See B1. |
| **Reject** | The check failed Sentinel's rules or a reviewer rejected it. |
| **Failed** | The check could not run, for example because a registry did not answer. |

| Credit history type | What it means |
| --- | --- |
| **Credits added** | A payment, plan or free trial added credits. |
| **Charge** | A completed check used credits. |
| **Refund** | Credits were given back. |
| **Adjustment** | DeepTrack's team corrected your balance. |

## Common questions

### Can I get a report for a custom date range or a whole year?

Not on the Reports page. It covers one calendar month at a time, for the last 12 months. Save each month as a PDF, or ask DeepTrack for a longer export.

### Why does the report say totals cover the first 5,000 checks?

The monthly report reads up to 5,000 checks. If you ran more in that month, the figures are partial and the report says so. Ask DeepTrack for a full export.

### Why don't the figures match last time I looked?

The report is built from your records each time you open it. A case decided late, or a check that finished after you looked, changes the totals. The PDF shows when it was generated.

### Can I export more than 100 credit history lines?

The CSV export holds the latest 100 lines. For older lines, use **Load more** on screen, or ask DeepTrack for a statement.

### Are test checks counted or charged?

Checks made with a test API key are left out of the monthly report. See C6 for how test checks are charged.

### Who sees the STR numbers?

Everyone who can open the report, including Viewers / Auditors, sees the two counts. Only Admins and Reviewers see the register itself.

## Related chapters

- [A2 Choosing a plan and paying](/help/a2)
- [A3 The dashboard at a glance](/help/a3)
- [A4 Your organization profile](/help/a4)
- [A10 The audit log](/help/a10)
- [B1 How Sentinel decides](/help/b1)
- [B14 Filing an STR or SAR](/help/b14)
- [C6 Results and credits](/help/c6)
