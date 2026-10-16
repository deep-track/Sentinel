---
id: b6
title: AML screening
summary: Screen a person or company against sanctions, PEP, Kenyan risk lists and adverse media, and read what each hit means.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

AML screening (anti-money laundering screening) checks a person or company against lists of people you must not deal with, or must deal with carefully. Run it when you onboard a customer, and whenever you need a fresh check.

One screening covers all of these sources:

- **Sanctions lists.** The OFAC Specially Designated Nationals list, the UN Security Council Consolidated List, the EU Consolidated Financial Sanctions List and the UK Sanctions List. Sentinel downloads fresh copies every day.
- **OpenSanctions.** Global sanctions, PEP and risk data. A PEP (politically exposed person) is someone who holds or held a prominent public role.
- **Sentinel Kenyan PEP register.** Kenyan national, county and parastatal office holders, and their relatives and close associates. DeepTrack's review team keeps it up to date from Kenya Gazette notices.
- **Kenyan risk lists.** Enforcement, debarment and wanted lists published by Kenyan authorities.
- **Adverse media.** Recent negative news about the subject.

Every hit is sorted into one or more of six categories: **Sanctions & watchlists**, **Politically exposed person**, **Special interest person / entity**, **Fitness & probity**, **Adverse media** and **Insolvency**.

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Developer** can run screenings.
- **Viewer / Auditor** can see the list of screenings and open every report, but can't run new ones. The form is replaced by "Your role can view screenings but not run new ones."
- Any member of your organization can open a screening report.
- If a screening needs review, who can decide the case depends on its category. An Admin sets this in **Settings** → **Review workflow**. By default only an Admin can clear a sanctions hit, and a Reviewer or above can clear a PEP or adverse media hit. See [B11 Deciding a review case](/help/b11).

## Step by step

### Run a screening

1. Click **AML Screening** in the sidebar.
2. Type the full name in **Subject name**.
3. Choose the **Entity type**: **Individual** or **Company**.
4. Optional: fill in **Country**, and any other names in **Also known as**, separated by commas (up to 10).
5. For an individual, add what you have: **Date of birth** (YYYY-MM-DD, YYYY-MM or YYYY), **Nationality**, and **National ID or passport number**. For a company, add the **Registration number** (for example PVT-AB1CD2E) and **Country of incorporation**.
6. To keep watching this customer, tick **Keep monitoring (re-screen daily, alert on new hits)**. See [B7 Ongoing monitoring](/help/b7).
7. Click **Run AML screening**. You see "Screening queued. Results will update automatically."

![AML Screening form with a subject entered](/help/shots/b6-form.png "TODO")

A date of birth or ID number matters. Without one, matches are on name and country only, and you will see more look-alikes.

### Read the result

1. Under **Recent screenings**, find the subject. The list shows your 50 most recent screenings, with a chip for each category that has hits, such as **PEP Class 2**.
2. Click the outcome button, for example **Needs review · View report**.
3. The report header shows the verdict and the reason in plain words.
4. **Risk summary** shows the number of hits in each category.
5. **Findings** groups the hits by category. Each group starts with **What to do**, then one card per match.
6. **Sources screened** shows each list and when it was downloaded.
7. To keep a copy, click **Download report (PDF)**, **Matches (CSV)** or **Evidence (JSON)**. See [B9 Reading a report and its PDF](/help/b9).

In Demo Bank Ltd, open the screening for Daniel Kipruto Langat. It shows a hit on the Kenyan PEP register.

![AML report for Daniel Kipruto Langat with a Kenyan PEP hit](/help/shots/b6-report-pep.png "TODO")

The screening for Viktor Petrovich Orlov shows an exact match on a sanctions list.

![AML report for Viktor Petrovich Orlov showing Match, do not proceed](/help/shots/b6-report-sanctions.png "TODO")

For an OpenSanctions match, click the **Record id** to open the listed person's profile.

## What each result means

### Verdicts

| On the list | On the report | What it means | What to do |
|---|---|---|---|
| **Clear** | **Clear** | No hits on any source, and every sanctions list was screened. | Continue onboarding. |
| **Needs review** | **Needs review** | At least one hit, or a list couldn't be screened. A review case is open. | Open the case and decide it ([B11](/help/b11)). |
| **Match** | **Match — do not proceed** | A strong sanctions match. A high-priority case is open. | Don't onboard or transact. Escalate to whoever clears sanctions hits. |
| **Failed** | **Screening failed** | Screening couldn't run. You aren't charged. | Run it again later. |
| **Queued**, **Screening…** | **Screening in progress** | Still running. | Wait; the page updates on its own. |

A screening is a **Match** only when the name matches a sanctions entry exactly, by alias or after normalisation (score 94 or more), and the listed country doesn't differ. An OpenSanctions sanctions match scoring 90 or more is also a Match, unless the date of birth differs. PEP, Kenyan register, risk-list and adverse media hits never reject on their own: they always go to review.

If a sanctions list or OpenSanctions can't be reached, or a daily list is more than three days old, the screening can't be **Clear**. It goes to review instead, and **Sources screened** shows the gap. An adverse media outage doesn't hold the screening.

### PEP classes

| Class | Who | Kenyan examples from the register |
|---|---|---|
| **PEP Class 1** | National or head-of-state level | Cabinet and Principal Secretaries, MPs and Senators, superior court judges, constitutional commissions |
| **PEP Class 2** | Regional, diplomatic or senior military | Governors and deputy governors, ambassadors, senior security officers |
| **PEP Class 3** | State-owned enterprise, international organisation, party or local government | County Executive Committee members, MCAs, state corporation boards, party officials |
| **PEP Class 4** | Family member or close associate | Relatives and close associates of a PEP |

A PEP whose level isn't known is treated as Class 1. A former PEP is marked "(former PEP — no current position)". By default, Class 1 and 2 hits get a high-priority case. An Admin changes this in **Settings** → **Screening rules** → **High-risk PEP classes**.

### Kenyan risk lists

The **Kenyan risk lists (Sentinel)** cover PPRA debarred firms and individuals, and CBK, CMA, IRA, SASRA and RBA enforcement actions (all **Fitness & probity**). They also cover EACC cases, DCI wanted persons and Assets Recovery Agency forfeiture cases (all **Special interest person / entity**). The **Programme / list** row says "ended" when a debarment has run out.

### Adverse media

Sentinel searches roughly the last three months of news. AI reads each article and decides whether it is about your subject, how serious it is and what it reports. An article counts only when it is about the subject and of medium or high severity, or possibly about the subject and of high severity. **About this subject** shows "Possibly — identity not confirmed" in that case. An Admin can limit which kinds of news count in **Settings** → **Screening rules** → **Adverse media**.

### How names are matched

- Case, accents and punctuation are ignored. "KAMAU JOHN" matches "John Kamau".
- Spelling variants count as the same name: Mohammed, Mohamed and Maxamed; Hussein and Xuseen; Yohana and John.
- Titles and connectors such as Hon, Dr, Sheikh, bin, binti, wa, arap and ole are ignored.
- Each part of the name must match. "John Kamau" doesn't match "John Kariuki", and "Ali" doesn't match "Wali".
- One extra name ("John Kamau" against "John Kamau Mwangi") is a partial match. It is held for review, never rejected.
- A date of birth more than a year apart rules out a PEP or risk-list match. On a sanctions list it means review, not an automatic **Match**.

**Match strength** on each card is **Strong** (94 or more), **Close** (85 to 93) or **Possible** (below 85). Hits below the **Match threshold** don't count. It is 70% by default, and an Admin can raise it to 95% in **Settings** → **Screening rules**. Kenyan register and risk-list hits need at least 85 whatever the threshold.

## Common questions

### How many credits does a screening cost?

On plans billed in Kenya shillings, one credit. On USD plans, 60 credits on Starter, 50 on Growth, 40 on Business and 35 on Enterprise. Ongoing monitoring of the subject is included. A failed screening isn't charged.

### What if I don't have the customer's date of birth or ID number?

You can still screen. Matches are then on name and country only, so expect more look-alikes to review. Add the details when you have them and screen again.

### Why is a hit listed under Previously cleared hits?

A reviewer cleared that hit for this customer before, so it is left out of the verdict. It comes back if it becomes more severe. This needs a customer reference, ID or registration number, or date of birth, so one person's cleared hit never hides hits for another person with the same name.

### Is a hit proof of wrongdoing?

No. A match is a lead for review. Compare the identifiers on each card with your customer before you act.

### How long are screenings kept?

For your organization's retention period, which can't be less than seven years. An Admin sets it in **Settings** → **Audit & data**.

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B7 Ongoing monitoring](/help/b7)
- [B8 Business checks (KYB)](/help/b8)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B14 Filing an STR or SAR](/help/b14)
- [A7 Screening rules](/help/a7)
- [C4 AML and monitoring API](/help/c4)
