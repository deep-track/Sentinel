---
id: d5
title: Kenyan risk lists and FATF countries
summary: Import PPRA, regulator, EACC, DCI and ARA lists into Sentinel, and update the FATF country lists after each plenary.
roles: Internal admin, Internal reviewer
---

## What it's for

The **Kenyan risk lists** page holds two things that every client's screening and risk rating depend on.

- **Kenyan risk lists.** Enforcement, debarment and wanted lists published by Kenyan authorities that the international data doesn't carry. Every active entry is screened in every AML check, KYB check, monitoring re-screen and counterparty screen. World Bank and AfDB debarment, Interpol red notices and the FRC domestic list already arrive through OpenSanctions, so you don't enter them here.
- **Country risk (FATF).** The FATF (Financial Action Task Force) call-for-action list (the "black list") and increased-monitoring list (the "grey list"). Customer risk ratings use them for the geography factor ([B12](/help/b12)).

You add list entries four ways: upload a publication, point Sentinel at one page on the authority's own site, import a CSV, or add one by hand. When AI reads a publication, nothing counts until you approve it.

## Who can use it

The page is under **Reviews** → **Kenyan risk lists** in the Back Office sidebar.

| Role | Can view | Can act |
|---|---|---|
| **Internal admin** (internal_admin, administrator, head, admin) | Yes | Yes: read, approve, import, add, remove, and save the FATF lists |
| **Internal admin** with view_only | Yes | No |
| **Internal reviewer** (reviewer, compliance_analyst, compliance_reviewer) | Yes | No |

If you can't act, the FATF boxes are greyed out with no **Save** button, and the three entry panels and **Remove** links are hidden. Every change is written to the audit log with your name.

## Step by step

### Choose the right list

| List | Authority and site | Client category |
|---|---|---|
| **PPRA debarred firms and individuals** | Public Procurement Regulatory Authority, ppra.go.ke | Fitness & probity |
| **CBK enforcement actions, revocations and warnings** | Central Bank of Kenya, centralbank.go.ke | Fitness & probity |
| **CMA enforcement actions** | Capital Markets Authority, cma.or.ke | Fitness & probity |
| **IRA enforcement actions** | Insurance Regulatory Authority, ira.go.ke | Fitness & probity |
| **SASRA enforcement actions** | Sacco Societies Regulatory Authority, sasra.go.ke | Fitness & probity |
| **RBA enforcement actions** | Retirement Benefits Authority, rba.go.ke | Fitness & probity |
| **EACC cases, convictions and wanted persons** | Ethics and Anti-Corruption Commission, eacc.go.ke | Special interest |
| **DCI wanted persons** | Directorate of Criminal Investigations, dci.go.ke | Special interest |
| **Assets Recovery Agency forfeiture cases** | Assets Recovery Agency, ara.go.ke | Special interest |
| **Other Kenyan official notices** | Any other official source (upload only) | Fitness & probity |

The tiles across the page show each list's count. Click a tile to show only that list; click it again to show all.

![Kenyan risk lists page with the list tiles](/help/shots/d5-tiles.png "TODO")

### Read a publication

1. In **Read a publication**, choose the list.
2. Type a **Title**, for example "PPRA debarred firms, Oct 2026".
3. Either choose a file (PDF up to 30 MB, .txt, .html or .htm), or type one page address in the box "…or one page on ppra.go.ke" (the site changes with the list).
4. Click **Read names**. You see "Reading. The names it lists appear below for approval."

A page address must start with https:// and be on the authority's own site. Sentinel checks the site's robots.txt first, fetches that one page once, and never follows links. If the site says no, the item fails with "...robots.txt doesn't allow fetching this page. Download it yourself and upload it." Do that.

### Approve the names

1. When reading finishes, the item shows "N names found. Tick the ones to add."
2. Check each line: the name, **person** or **organisation**, the reason, the action and the reference.
3. Tick the right lines, or click **Tick all** and untick the wrong ones.
4. Click **Approve N**. You see "Added N."

![Names read from a PPRA publication, ready to approve](/help/shots/d5-approve.png "TODO")

Approval is final. Lines you didn't tick can't be approved later; add them by hand. Sentinel doesn't check for duplicates, so search for the name first when you re-read an updated list.

### Import a CSV

1. Build a CSV with a header row. Required: `name`, `entity_type` (`individual` or `entity`) and `reason`. Optional: `action`, `start_date`, `end_date`, `reference` and `aliases` (semicolons between them).
2. Write dates as YYYY-MM-DD. Any other format is dropped without a warning.
3. In **Import CSV**, choose the list, choose the file and click **Import**. You see "Imported N" and, if any were skipped, "; M lines skipped".

```csv
name,entity_type,reason,action,start_date,end_date,reference
Example Supplies Ltd,entity,Fraudulent tender documents,Debarred 3 years,2025-11-01,2028-10-31,PPRA/DEB/2025/014
```

The file can be up to 5 MB, and only the first 20,000 rows are read. Which lines were skipped isn't shown, so compare "Imported N" with your row count.

### Add one entry

1. In **Add an entry**, choose the list, fill in **Name**, choose **Organisation** or **Person**, and fill in **Why they are listed**.
2. Optional: **Action, e.g. Debarred 3 years**, **Ends (YYYY-MM-DD)** and **Reference**.
3. Click **Add**. You see "Added".

Get **Organisation** or **Person** right. Sentinel only matches people against people and organisations against organisations.

### Remove an entry

1. Search with **Search name, reason, reference**. The table shows up to 500 entries.
2. Click **Remove** and confirm. Screening stops matching the entry at once.

Don't remove a debarment just because it has ended. Clients see it marked "ended", which is still useful history.

### Update the FATF lists

1. After each FATF plenary (February, June and October), read the two FATF public statements on fatf-gafi.org: the call-for-action list and the increased-monitoring list.
2. In **Country risk (FATF)**, edit **Call for action (black list)** and **Increased monitoring (grey list)**. Use two-letter ISO codes, separated by commas or spaces, for example "KP, IR, MM".
3. Set **FATF statement date** to the statement's date, as YYYY-MM-DD.
4. Click **Save**. You see "FATF lists saved. New ratings use them."

![Country risk (FATF) panel](/help/shots/d5-fatf.png "TODO")

Saving replaces both lists. An empty box saves an empty list, so check both before you click **Save**. Ratings already given don't change until the customer is screened again; monitored customers are re-screened daily.

Keep Kenya (KE) on the grey list while FATF lists it. Clients billed in Kenya shillings don't get geography points for KE, so it only affects other clients.

### Recurring tasks

- [ ] Daily: check **Read a publication** for items still reading, failed or waiting for approval.
- [ ] Weekly: check the PPRA, EACC and DCI sites for new debarments, cases and wanted notices, and read them in.
- [ ] Monthly: check the CBK, CMA, IRA, SASRA, RBA and ARA sites for new enforcement actions and forfeiture cases.
- [ ] After each FATF plenary: update both FATF lists and the statement date within a week.

## What each result means

### Publication status

| Shown | Meaning | What to do |
|---|---|---|
| **Reading…** | AI is reading the file or page. | Wait. |
| Red error text | Reading failed, for example the robots.txt refusal, "The page returned HTTP 404." or "The page redirected off the authority's site." | Download the publication yourself and upload it. |
| "N names found" | Ready for approval. | Check, tick, approve. |
| Gone from the panel | Approved. | Nothing more. |

The panel shows only the three newest items that aren't approved. A failed item can't be dismissed; it drops out as newer items arrive. Text over 400,000 characters is cut off without a warning, so split long publications.

### Entry dates

**Dates** shows "start – end". "?" means no start date and "open" means no end date. Once the end date passes, the entry still matches, and the client sees "ended" in **Programme / list**.

### FATF panel hint

The header shows "Lists as of" the statement date. After 140 days it adds "— check for a newer FATF statement". With three plenaries a year, seeing that means a plenary was missed.

### What a hit does for the client

A list hit is always a review case in the list's category, never an automatic reject. It adds 20 points (Fitness & probity) or 25 points (Special interest) to the customer's risk rating. A call-for-action country adds 50 and makes the customer high risk; a grey-list country adds 20.

## Common questions

### How strict is the match?

The name must score at least 85, or the client's threshold if higher. Legal forms such as Ltd, PLC and Holdings are ignored for organisations. There is no date of birth on these lists, so add aliases and references to help reviewers.

### Why can't I enter a page address for some lists?

**Other Kenyan official notices** has no official site, so it takes uploads only.

### Can Sentinel watch an authority's site for changes?

No. Sentinel fetches one page only when you ask. Checking for new publications is a recurring task.

### Can I undo a removal?

Not from this screen. Add the entry again.

### Who sees who added an entry?

Only DeepTrack. Clients see the list name, reason, action, authority and reference, never the staff member or file.

## Related chapters

- [D4 The Kenyan PEP register](/internal-ops/help/d4)
- [B6 AML screening](/help/b6)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B8 Business checks (KYB)](/help/b8)
- [A7 Screening rules](/help/a7)
