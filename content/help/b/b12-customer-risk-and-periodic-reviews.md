---
id: b12
title: Customer risk and periodic reviews
summary: Understand each customer's low, medium, high or prohibited rating, what drives it, and how to record periodic reviews when they fall due.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

A risk-based approach means you watch high-risk customers more closely than low-risk ones. Sentinel rates every customer it screens as **Low**, **Medium**, **High** or **Prohibited** risk. The rating sets how often you review the customer.

You see the rating in two places:

- the **Customer risk rating** section of every AML screening report and KYB report, with the factors behind it, and
- the **Customer risk** page, which lists every customer under ongoing monitoring, with their next review date.

Only monitored customers get review dates. To put a customer on the review cycle, enrol them for monitoring ([B7](/help/b7)).

## Who can use it

- Everyone in your organization can open the **Customer risk** page and the ratings on reports.
- **Admin**, **Reviewer** and **Analyst** can record a review with **Mark reviewed**. The button also shows for a **Developer** or **Viewer / Auditor**, but Sentinel refuses their review.
- Only an **Admin** can change the review periods, in **Settings** → **Screening rules**.
- DeepTrack's review team keeps the FATF country lists up to date.

## Step by step

### Read a customer's rating

1. Open the customer's AML screening report (see [B6](/help/b6)).
2. Find **Customer risk rating**. It shows a badge such as **High risk · 65**, how often to review, and one line per factor with its points.

In Demo Bank Ltd, Daniel Kipruto Langat is rated **High risk · 65**: a baseline of 10, plus 35 for a Class 2 PEP and 20 for real estate. He is reviewed every 12 months.

![Customer risk rating section on Daniel Kipruto Langat's report](/help/shots/b12-rating-detail.png "TODO")

### Find customers due for review

1. Click **Customer risk** in the sidebar.
2. The tiles at the top count your monitored customers at each level: **high risk**, **medium risk**, **low risk**, **prohibited risk** and **Not rated yet**.
3. The list header says how many are due, for example "1 due for periodic review", or "No reviews due".
4. Tick **Due only** to hide customers who aren't due yet.
5. Customers due for review come first, then by risk level, then by the nearest review date.
6. Each row shows the customer's top three risk factors, the rating badge and **Review due** or **Next review** with the date. Click the name to open their enrolment screening.

![Customer risk page with Daniel Kipruto Langat due for review](/help/shots/b12-customer-risk.png "TODO")

### Record a periodic review

1. Do the review in line with your own policy. For example, refresh the customer's documents, confirm their source of funds and read their latest screening.
2. On the **Customer risk** page, click **Mark reviewed** on the customer's row.
3. Describe what the review covered in the box, then confirm. Write at least five characters.
4. You see "Review recorded. The customer is re-screened now."

Sentinel then sets the next review date from today, using the customer's current rating. It also re-screens the customer straight away. The note, your name and the time go into the audit log.

### Change the review periods (Admin)

1. Go to **Settings** → **Screening rules** → **Customer risk rating and periodic review**.
2. Set **High risk: review every (months)**, **Medium risk: review every (months)** and **Low risk: review every (months)**.
3. Click **Save changes**. High-risk customers must be reviewed at least as often as medium-risk ones.

## What each result means

### Risk levels

| Level | When | Default review | What to do |
|---|---|---|---|
| **Low** | Score below 30 | Every 36 months | Standard due diligence. |
| **Medium** | Score 30 to 59 | Every 24 months | Standard due diligence, closer watch. |
| **High** | Score 60 or more, any PEP hit, or a FATF call-for-action country | Every 12 months | Enhanced due diligence, senior approval. |
| **Prohibited** | A confirmed sanctions match (verdict **Match**) | None: "Exit or don't onboard: a confirmed sanctions match." | Don't onboard, or exit the relationship. |
| **Not rated** | No rating yet | No review date | Wait for the first complete screening. |

Review periods can be 1 to 60 months for high and medium risk, and 1 to 120 months for low risk.

### What drives the score

Every customer starts at 10 points. Factors add to that, up to a maximum of 100.

| Factor | Points |
|---|---|
| FATF call-for-action country (North Korea, Iran, Myanmar) | +50 |
| FATF country under increased monitoring | +20 |
| Other foreign connection | +5 |
| Sanctions: confirmed match / possible match under review | +100 / +40 |
| PEP Class 1 or 2 / Class 3 / Class 4 | +35 / +25 / +20 |
| Special interest person or entity | +25 |
| Fitness & probity (enforcement, debarment, disqualification) | +20 |
| Adverse media | +20 |
| Insolvency | +10 |
| Company or organisation | +5 |
| Higher-risk industry | +20 |
| Onboarded remotely (KYB) | +5 |
| KYB ownership: owners not traced / two or more company layers / foreign company shareholders | +20 / +10 / +10 |

The countries come from the screening's **Country**, **Nationality** and **Country of incorporation**. Enter them as two-letter codes such as KE or UG, so Sentinel recognises them. Sentinel uses the FATF lists from its 19 June 2026 statement, and DeepTrack's review team updates them after each FATF plenary (February, June and October).

Kenya is on the FATF increased-monitoring list. If your organization is billed in Kenya shillings, Sentinel treats Kenya as your home country, so a Kenyan customer gets no geography points.

Higher-risk industries are money services (remittance, forex, mobile money agency), virtual assets, gambling and betting, precious metals and stones, real estate, charities and NGOs, arms and defence, cash-intensive businesses, and trust and company services. For a company, Sentinel also looks for words in its name, such as "forex", "betting" or "gold".

Only hits still standing count. When a reviewer clears an AML case, the rating is worked out again without those hits.

### Review dates

- The first review date is the enrolment date plus the period for the customer's rating.
- If a new screening raises the rating, the date moves earlier. A lower rating never moves it later.
- If a customer becomes **Prohibited**, their review is due at once.
- **Mark reviewed** sets the next date from the day you record the review.

## Common questions

### Who is told when reviews fall due?

Every morning Sentinel sends one notification listing the customers that have just become due. By default it goes to Admins, Reviewers and Analysts, by email too. If a customer stays due, they appear again after 30 days. An Admin changes this in **Settings** → **Notifications** under **Periodic reviews due**.

### Does marking a review cost credits?

No. Recording the review and the re-screening that follows aren't charged.

### Can I change a customer's rating by hand?

No. The rating comes from the screening results. To change it, decide any open cases, or correct the customer's details and screen again.

### Why does a customer show Not rated?

The rating is set when a screening for the customer completes. Until then, the customer shows **Not rated**.

### Why isn't my customer on the Customer risk page?

The page shows only customers under ongoing monitoring, up to 500 of them. Enrol the customer with **Keep monitoring** when you screen them ([B7](/help/b7)).

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [B8 Business checks (KYB)](/help/b8)
- [B11 Deciding a review case](/help/b11)
- [B13 Transaction monitoring](/help/b13)
- [A7 Screening rules](/help/a7)
