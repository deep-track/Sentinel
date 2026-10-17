---
id: a3
title: The dashboard at a glance
summary: Read the Overview and Client Portal pages to see your checks, items waiting for review, credits and deepfakes stopped.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

Sentinel has two summary pages. Use them at the start of the day to see how busy your team is and whether anything needs attention.

- **Overview** shows the last 30 days: how many checks ran, how many are waiting for a person, the deepfakes and AI forgeries stopped, and the latest checks. It also shows your credit balance.
- **Client Portal** shows the current calendar month for one organization: checks this month and today, credits used, your balance, your prices, and a searchable list of recent checks.

Neither page changes anything. To act on a check, open it from its own page, or work it in **Reviews**.

## Who can use it

- Everyone on your team can open **Overview** and **Client Portal**: **Admin**, **Reviewer**, **Analyst**, **Developer** and **Viewer / Auditor**.
- Both pages are read-only, so there is nothing to restrict.
- If you belong to more than one organization, the figures on **Overview** cover all of them. The credit balance, and everything on **Client Portal**, cover only the organization you picked under **Organizations** at the top of the sidebar.

## Step by step

### Read the Overview page

1. Click **Overview** in the sidebar. The page is headed **Dashboard**. Sentinel also opens it after you sign in.
2. Read the credit card at the top: **Credit balance · Demo Bank Ltd**, with the number of credits left. If the balance reaches zero, a warning says new checks will be rejected, with a link to **Billing & Credits**.
3. Read the four tiles:
   - **Scans (30 days)**: every check started in the last 30 days.
   - **Avg. verification**: the average time from start to finish for completed checks.
   - **Flagged / review**: checks from the last 30 days still waiting for a person to decide.
   - **Active API keys**: keys that are not revoked.
4. Read the **Deepfakes and AI forgeries stopped · last 30 days** tile. The large number is the checks where a deepfake or AI forgery was found. Next to it you see how many checks were screened by DeepTrack Live and document forensics.
5. Under **Verification mix**, see how the 30 days split by type: **KYC / Identity**, **KYB**, **IDP / Documents**, **AML** and **Liveness**, with a count and a percentage.
6. Under **Recent verifications**, see the 10 latest checks: **Case ID**, **Type**, **Subject**, **Verdict** and **Submitted**.

![Overview page for Demo Bank Ltd with the credit balance, the four tiles and the deepfakes tile](/help/shots/a3-overview.png "TODO")

### Read the Client Portal page

1. Click **Client Portal** in the sidebar. The top bar shows your account status, for example **Account active**, and your plan, for example "Demo Bank Ltd · Business plan".
2. Read the credits card:
   - **Credits used this month**, with the value in your billing currency, for example KES.
   - **Balance remaining**, in credits and what they are worth.
   - If your organization has a monthly plan limit, a bar shows the percentage of it used, with the alert level, for example "alert at 10%". Otherwise it says "No monthly plan limit set for this organization."
3. To see what each check costs, open **Your prices**. It lists each check with its price in credits and in money. You pay only when a check completes.
4. Read the four tiles: **Scans this month** (with today's count under it), **Avg. verification** (with the p95 time, which 95% of checks beat), **Flagged / review** and **Active API keys** (with the revoked count and a **manage** link).

![Client Portal for Demo Bank Ltd, showing credits used this month and the four tiles](/help/shots/a3-portal.png "TODO")

### Find a recent check

1. On **Client Portal**, type a scan ID or a name in **Search your scans by ID or subject…**, for example "Wanjiku Mwangi".
2. To narrow the list, choose from the verdict filter: **All verdicts**, **Passed**, **Review**, **Flagged** or **In progress / failed**.
3. The list holds your organization's 50 latest checks. For older checks, use the page for that kind of check, such as **Identity (KYC)** or **AML Screening**.

![Recent verifications on the Client Portal, filtered to Review](/help/shots/a3-portal-recent.png "TODO")

## What each result means

### Verdicts on Overview

| Badge | What it means | What to do |
|---|---|---|
| **approved** | The check passed. | Nothing. |
| **rejected** | The check failed, or a reviewer rejected it. | Follow your policy for that customer. |
| **needs review** | A person must decide. | Work the case in **Reviews**. See [B11 Deciding a review case](/help/b11). |
| **failed** | The check could not finish, for example a registry was unavailable. | Run it again. |
| **queued** or **processing** | The check is still running. | Wait. The page shows the latest when you reload it. |

### Verdicts on Client Portal

| Badge | What it means |
|---|---|
| **passed** | The check passed. |
| **review** | A person must decide. |
| **flagged** | The check was rejected. |
| **failed** | The check could not finish. |
| **queued** or **processing** | The check is still running. |

The **Confidence** column shows Sentinel's confidence in the verdict, where the check type gives one. A dash means there isn't one.

## Common questions

### Why do the two Flagged / review tiles show different numbers?

They count different things. On **Overview**, the tile counts the last 30 days' checks still waiting for a person. On **Client Portal**, it counts this calendar month's checks that are waiting for review or were rejected.

### Why is "this month" different from "30 days"?

**Overview** always looks back 30 days from now. **Client Portal** starts on the first day of the current month, in your own time zone.

### Does opening these pages cost credits?

No. Only completed checks cost credits. **Your prices** on **Client Portal** shows what each one costs.

### What happens when my balance reaches zero?

New checks are refused until credits are added. Your team sees a warning on both pages. See [A2 Choosing a plan and paying](/help/a2).

### Can I change the period or download these figures?

Not on these pages. For monthly figures you can download, use **Reports**. See [A12 Usage and reports](/help/a12).

### What counts as a deepfake stopped?

A selfie or liveness video that DeepTrack Live judged a fake or synthetic face, or a document that showed signs of being AI-generated, edited or given a new photo. See [B10 Fraud signals explained](/help/b10).

## Related chapters

- [A1 Signing up and your free trial](/help/a1)
- [A2 Choosing a plan and paying](/help/a2)
- [A12 Usage and reports](/help/a12)
- [B9 Reading a report and its PDF](/help/b9)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
