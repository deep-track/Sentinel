---
id: d4
title: The Kenyan PEP register
summary: Keep Sentinel's Kenyan PEP register current from Kenya Gazette issues, CSV imports and single entries, and know how each entry is screened.
roles: Internal admin, Internal reviewer
---

## What it's for

The Kenyan PEP register is Sentinel's own list of Kenyan PEPs (politically exposed persons: people who hold or held a prominent public role), plus their relatives and close associates. It covers national, county and parastatal office holders that the international PEP data misses or lists late.

Every active entry is screened in every AML check, KYB check, daily monitoring re-screen and transaction counterparty screen, for every client. Clients see a hit as a **Politically exposed person** finding from the "Sentinel Kenyan PEP register". They are told that DeepTrack's review team keeps it up to date from Kenya Gazette notices, so this chapter is how we keep that promise.

You add people three ways:

- **Kenya Gazette.** You upload an issue. AI reads it and lists the appointments, revocations and ends of term. Nothing is added until you approve it.
- **CSV import.** For county officials, boards, relatives and associates you have compiled yourself.
- **Add a person.** One entry at a time.

Sentinel never downloads the Gazette. Kenya Law's terms forbid scraping, so you get each issue yourself, from the Government Printer or under Kenya Law's terms, and upload the file.

## Who can use it

The page is under **Reviews** → **Kenyan PEP register** in the Back Office sidebar.

| Role | Can view | Can act |
|---|---|---|
| **Internal admin** (internal_admin, administrator, head, admin) | Yes | Yes: upload and approve Gazette issues, import CSV, add and remove entries |
| **Internal admin** with view_only | Yes | No |
| **Internal reviewer** (reviewer, compliance_analyst, compliance_reviewer) | Yes | No |

If you can't act, the three upload panels and the **Remove** links are hidden, and you see only the **Entries** table. Every change is written to the audit log with your name.

## Step by step

### Read a Kenya Gazette issue

1. Get the issue as a PDF (up to 30 MB) or a .txt file. Weekly issues come out on Fridays; special issues can appear on any day.
2. Open **Kenyan PEP register**. In the **Kenya Gazette** panel, type the issue in the first box, for example "Vol. CXXVIII No. 181, 15 Oct 2026".
3. Choose the file.
4. Click **Read appointments**. You see "Reading the issue. Its appointments appear below for approval."
5. The issue appears under the button with **Reading…**. You can leave the page while it reads.

![Kenya Gazette panel with an issue being read](/help/shots/d4-gazette-reading.png "TODO")

### Approve the appointments

1. When reading finishes, the issue shows "N appointments found. Tick the ones to add."
2. Check each line against the Gazette notice: the name as printed, the position and organisation, the level, the county, the date and the Gazette notice number. A grey **ends** badge marks a revocation or end of term.
3. Tick each line that is a real appointment to a public function. Use **Tick all** if every line is right, then untick the wrong ones.
4. Click **Approve N**. You see "Added X, ended Y."

![Extracted appointments with ticks and the Approve button](/help/shots/d4-gazette-approve.png "TODO")

Approval is final for that issue. Lines you didn't tick can't be approved later. If you missed one, add it with **Add a person**.

How an **ends** line is applied:

- If the register already has a current entry with exactly the same name and the same position (capital letters aside), Sentinel sets that entry's end date to the notice date. It is counted under "ended".
- If there is no exact match, Sentinel adds a new entry that already has an end date. Then search for the person and **Remove** any older entry that still shows "current", because the Back Office has no way to edit an end date.

Before you approve a line, search **Entries** for the name. Sentinel doesn't check for duplicates. A duplicate gives the client two identical hits.

### Import a CSV

1. Build a UTF-8 CSV with a header row. The required columns are `full_name`, `position` and `level`. The optional ones are `organisation`, `county`, `start_date`, `end_date`, `birth_date`, `aliases` and `related_to`.
2. For `level`, use one of the codes in the table under "What each result means".
3. Write dates as YYYY, YYYY-MM or YYYY-MM-DD. A date in any other format is dropped without a warning.
4. Separate aliases with semicolons, up to 10.
5. Fill in `related_to` on every `family_associate` row, for example "Spouse of Hon. Daniel Kipruto Langat, MCA Nakuru". One `family_associate` row without it stops the whole file.
6. In the **Import CSV** panel, choose the file and click **Import**. You see "Imported N" and, if any were skipped, "; M lines skipped".

```csv
full_name,position,level,organisation,county,start_date,birth_date,aliases,related_to
Daniel Kipruto Langat,Member of County Assembly,county_government,County Assembly of Nakuru,Nakuru,2022-08,1978-03-14,Dan Langat,
Grace Chebet Langat,Spouse,family_associate,,Nakuru,,,,"Spouse of Daniel Kipruto Langat, MCA Nakuru"
```

The file can be up to 5 MB. Only the first 20,000 data rows are read; split a larger file. The skipped-line details aren't shown on screen, so count the rows you expected against "Imported N". The file name is kept as the entry's source.

![Import CSV panel with the column list](/help/shots/d4-import-csv.png "TODO")

### Add one person

1. In **Add a person**, fill in **Full name** and **Position**, for example "Member of County Assembly".
2. Optional: **Organisation (optional)**, **County**, **Start (YYYY-MM-DD)** and **Also known as (; separated)**.
3. Choose the level from the list. For **Family member or close associate**, fill in **Related to**.
4. Click **Add**. You see "Added to the register".

The form has no date of birth or end date. To give either, use a one-line CSV.

### Find and remove an entry

1. Type in **Search name, position, county** above **Entries**. The table shows up to 500 entries, newest first.
2. Click **Remove** at the end of the row and confirm "Remove ... from the register? Screening stops matching them."

Remove only an entry that is wrong or a duplicate. Someone who has left office stays on the register with an end date, because a former PEP is still a PEP.

![Entries table filtered by a search](/help/shots/d4-entries.png "TODO")

### Recurring tasks

- [ ] Daily: check the **Kenya Gazette** panel for issues still showing **Reading…** or an error, and for any special issue published that day.
- [ ] Weekly: upload each Friday's Kenya Gazette issue and approve its appointments the same day.
- [ ] Weekly: approve every issue waiting in the panel. The panel shows only the three newest issues that are reading, ready or failed, so an old one can hide a new one. A failed issue can't be dismissed; it drops out as newer issues arrive.
- [ ] After each general election, county by-election or Cabinet change: upload the Gazette notices and import the new MCAs, CEC members and Chief Officers by CSV.
- [ ] Quarterly: search for duplicates of new entries, and remove entries with an end date that should have replaced a current one.

## What each result means

### Issue status in the Kenya Gazette panel

| Shown | Meaning | What to do |
|---|---|---|
| **Reading…** | AI is reading the issue. | Wait. If it never changes, upload the issue again. |
| Red error text | The issue couldn't be read. For example, "The PDF is larger than 30 MB; split it." or "The issue is too long to read in one go; split it." | Fix what the error says, then upload again. |
| "N appointments found" | Ready for approval. | Check, tick and approve. |
| Gone from the panel | Approved. | Nothing more. |

A text file over 400,000 characters is cut off without a warning. Split long issues into parts.

### Levels and PEP classes

| Level code | Label | Class |
|---|---|---|
| national_executive | National executive | 1 |
| parliament | Parliament | 1 |
| judiciary | Judiciary | 1 |
| constitutional_office | Constitutional commission or independent office | 1 |
| security | Security services | 2 |
| diplomatic | Diplomatic service | 2 |
| county_executive | County governor / deputy governor | 2 |
| county_government | County government | 3 |
| state_corporation | State corporation / parastatal | 3 |
| political_party | Political party | 3 |
| family_associate | Family member or close associate | 4 |

The **Level** column shows a red badge for Class 1 and 2 and an amber badge for Class 3 and 4. The class drives the client's case priority and adds 35, 25 or 20 points to the customer risk rating ([B12](/help/b12)).

### Term and source

- **Term** shows "start – end". "?" means no start date, and "current" means no end date. A client sees an entry whose end date has passed as a former PEP.
- **Source** is **gazette** (with the issue and notice number), **import** (with the file name) or **manual**.

## Common questions

### How strict is the match?

The name must score at least 85, or the client's match threshold if that is higher. Aliases count. A date of birth more than a year apart rules the entry out, so a birth date cuts false hits on common names.

### When do clients see a new entry?

At their next screening of that name. Monitored customers are re-screened daily, so a new PEP among them raises an alert within a day.

### Can I undo a removal?

Not from this screen. A removed entry stops matching at once and is hidden from **Entries**. Add it again if you removed it by mistake.

### Should I add MPs, senators and judges?

You can, but the international PEP data already covers them. The register matters most for county officials, MCAs, parastatal boards, relatives and associates.

### Does AI decide who goes on the register?

No. AI only proposes lines from the issue. Nothing is screened until an internal admin approves it.

## Related chapters

- [D5 Kenyan risk lists and FATF countries](/internal-ops/help/d5)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [B12 Customer risk and periodic reviews](/help/b12)
- [A7 Screening rules](/help/a7)
