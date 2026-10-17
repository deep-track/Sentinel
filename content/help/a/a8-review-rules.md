---
id: a8
title: Review rules
summary: Set who can make the final decision on each kind of case, which cases need two people, how cases are assigned, deadlines and reason codes.
roles: Admin
---

## What it's for

When a check can't be decided automatically, Sentinel opens a review case for your team. The **Review workflow** settings decide how your team works those cases:

- **Who can decide what**: the lowest role that can make the final decision on each kind of case. This is your clearance by role.
- **Four-eyes approval**: which kinds of case always need two people, one to recommend and a second to approve.
- **Maker-checker**: whether the person who ran a check is barred from making the final decision on it.
- **Assignment**: whether new cases wait to be taken, or go to people automatically.
- **Review deadlines**: how many hours your team has to decide a case.
- **Reason codes**: the list of reasons people choose from when they approve or reject.

The defaults follow common practice for Kenyan banks and SACCOs under CBK and SASRA supervision. You can use Sentinel without changing anything here.

## Who can use it

- Only an **Admin** can change these settings.
- Every other role can open **Settings** → **Review workflow** and read the rules. They see "Only your organization's Admin can change these settings." and the controls are greyed out.
- Every change is saved in the audit log, with the settings before and after. See [A10 The audit log](/help/a10).

## Step by step

1. Click **Settings** in the sidebar, then the **Review workflow** tab.
2. Make your changes in the sections below.
3. Click **Save changes** in the bar at the bottom. To throw away your edits, click **Discard**.

![Review workflow settings for Demo Bank Ltd, showing Who can decide what and Four-eyes approval](/help/shots/a8-review-workflow.png)

### Who can decide what

Sentinel sorts every case into the most serious category it falls under. For each category, choose the lowest role that can make the final decision, from **Analyst or above**, **Reviewer or above** or **Admin or above**. Anyone below that role can still investigate the case and send a recommendation.

| Category | Default | Four-eyes by default |
|---|---|---|
| **Sanctions hit** | Admin or above | Yes |
| **PEP** (politically exposed person: someone who holds or held a prominent public role) | Reviewer or above | Yes |
| **Adverse media** (negative news about the customer) | Reviewer or above | No |
| **Document fraud or AI-generated** | Reviewer or above | Yes |
| **Other high-risk case** | Reviewer or above | No |
| **Standard case** | Analyst or above | No |

A Developer or Viewer / Auditor can never decide a case, whatever you choose here.

### Four-eyes approval

1. Tick each category that must always have two people. The first person sends a recommendation. A second person, with clearance for that category, makes the final decision.
2. Leave **Maker-checker** ticked (the default) if the person who ran a check must not make the final decision on it. Their decision becomes a recommendation instead.

A decision also becomes a recommendation when the person has no clearance for the category. So with the defaults, an Analyst who works a PEP case for Otieno Odhiambo sends a recommendation, and a Reviewer or Admin approves it.

### Assignment

Choose how new cases reach your team:

- **Manual**: cases wait in the unassigned queue. People take them, or a Reviewer or Admin assigns them. This is the default.
- **Automatic (share evenly)**: each new case goes to the Analyst, Reviewer or Admin with the fewest open cases in that queue. On a tie, the longest-standing member gets it. That person gets a "Case assigned to you" alert.

To limit the queues a person gets cases from (for example, only **AML screening**), go to **Settings** → **Team** and use the **Review queues** column. "All queues" means they get every kind. See [A5 Team members and roles](/help/a5).

Whatever you choose, only a Reviewer or Admin can assign a case to someone else. An Analyst can take an unassigned case or release their own.

### Review deadlines

Enter the hours from when a case opens to its final decision, in **High priority**, **Normal priority** and **Low priority**. The defaults are 24, 72 and 72 hours. Each must be a whole number from 1 to 720 (30 days).

When a case passes its deadline, Sentinel raises it to high priority and sends the **Missed review deadline** alert once. See [A9 Notifications](/help/a9).

A PEP in a high-risk class opens as high priority. You choose those classes in **Settings** → **Screening rules**. See [A7 Screening rules](/help/a7).

### Reason codes

1. Leave **Require a reason for every decision** ticked if every approval and rejection must carry a reason from your list.
2. Edit **Approve reasons** and **Reject reasons**, one per line. You can have up to 30 of each, and each can be up to 120 characters. Blank lines and repeats are removed when you save.

The default approve reasons are:

```text
False positive: different person or entity
Hit reviewed: risk within appetite
Document verified manually
Enhanced due diligence completed
Senior management approval obtained
```

The default reject reasons are:

```text
Confirmed sanctions match
PEP: risk outside appetite
Adverse media: risk outside appetite
Fraudulent or altered document
AI-generated document
Insufficient or inconsistent information
```

The reasons appear in the audit log and the monthly report on the **Reports** page. Write them so an examiner from CBK or the FRC can understand them without asking.

![Reason codes section with the approve and reject lists](/help/shots/a8-reason-codes.png)

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| "Settings saved" | Your changes are live and recorded in the audit log. | Nothing. |
| "You have unsaved changes." | You edited something but haven't saved it. | Click **Save changes** or **Discard**. |
| "Reason codes are required, so keep at least one approve and one reject reason." | You left a list empty while reasons are required. | Add a reason, or untick **Require a reason for every decision**. |
| "The high priority deadline (hours) must be a whole number from 1 to 720." | A deadline is out of range. | Enter a whole number from 1 to 720. |
| "Approve reasons: at most 30 entries." | The list is too long. | Merge or remove reasons. |
| "Only your organization's Admin can change these settings." | You are not an Admin, so you can only read the rules. | Ask your Admin. |

## Common questions

### Do changes apply to cases that are already open?

Clearance, four-eyes, maker-checker and the reason lists apply at once, including to open cases. Deadlines are set when a case opens, so a new deadline only applies to new cases. Automatic assignment also only applies to new cases.

### Can I make every case need two people?

Yes. Tick every category under **Four-eyes approval**. Make sure you have at least two people with clearance for each category, or cases will wait with no one able to approve them.

### What if our only Admin also ran the check?

With **Maker-checker** on, they can only recommend. Another person with clearance must decide it. If you are a small team, consider lowering the clearance for that category, or add a second Admin in **Settings** → **Team**.

### If I remove a reason, what happens to past decisions that used it?

Nothing. Past decisions keep their reason in the case history and the audit log. People just can't choose it for new decisions.

### Do these rules apply to disputes?

No. A result your team disputed is decided by DeepTrack's review team. See [B15 Disputes](/help/b15).

### Does changing these settings cost credits?

No. Review settings and review decisions have no charge.

## Related chapters

- [B11 Deciding a review case](/help/b11)
- [A5 Team members and roles](/help/a5)
- [A7 Screening rules](/help/a7)
- [A9 Notifications](/help/a9)
- [A10 The audit log](/help/a10)
- [B15 Disputes](/help/b15)
