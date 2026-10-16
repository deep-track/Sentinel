---
id: a10
title: The audit log
summary: See who did what and when in your organization, filter the log, and download it as a CSV file for an examiner or auditor.
roles: Admin, Reviewer, Analyst, Viewer / Auditor
---

## What it's for

The audit log is your organization's permanent record of activity in Sentinel. It shows who did what, and when. It records:

- team changes: invitations, joins, role changes, review queues, deactivations;
- review work: assignments, recommendations, approvals, rejections, escalations, missed deadlines;
- settings changes, with the values before and after;
- API keys and webhooks;
- checks: who or which API key ran each one, and when it completed;
- disputes, data removal requests and STR (suspicious transaction report) activity.

Entries can't be edited or deleted, by your team or anyone else. When a CBK, SASRA or FRC examiner asks how a decision was made, or who changed a rule, this is where you find it.

## Who can use it

- **Admin**, **Reviewer**, **Analyst** and **Viewer / Auditor** can read the log and download it.
- **Developer** can't read the audit log.
- Only an **Admin** sees the **Data retention** section below the log. See [A11 Data retention and data requests](/help/a11).

The **Viewer / Auditor** role is meant for internal auditors and external examiners. It can read the log and cases but can't change anything. See [A5 Team members and roles](/help/a5).

## Step by step

### Read the log

1. Click **Settings** in the sidebar, then the **Audit & data** tab.
2. The **Audit log** shows the newest entries first, 100 at a time. Each row has:
   - **When**: the date and time, in your browser's time zone.
   - **Who**: the person's name. "Sentinel" means the system did it, for example flagging a missed deadline. "API:" followed by a key name means one of your API keys did it. DeepTrack staff show by name, or as "DeepTrack".
   - **What**: what happened in plain English, such as "Approved a case" or "Changed the review workflow", with the system code for that action in small type underneath.
   - **Details**: key facts, such as the email invited, the new role, the reason and notes for a decision, or the check reference.
3. Click **Load more** at the bottom to see older entries.

![Audit log for Demo Bank Ltd, showing case decisions and a settings change](/help/shots/a10-audit-log.png "TODO")

### Filter the log

Use the list next to the **CSV** button to show one kind of entry:

| Filter | What it shows |
|---|---|
| **Everything** | Every entry. |
| **Team** | Invitations, joins, role and queue changes, deactivations. |
| **Review decisions** | Assignments, recommendations, send-backs, escalations, missed deadlines, approvals and rejections. |
| **Settings, API keys & webhooks** | Changes to any Settings tab, API keys and webhook endpoints. |
| **Checks** | Checks run, AML screenings, monitoring alerts, document checks and disputes. |

Data removal and STR entries appear only under **Everything**.

### Export the log for an examiner

The **CSV** button downloads the entries currently loaded on the page, with the filter you chose. To cover a longer period, load more first.

1. Choose the filter. For a full record, choose **Everything**.
2. Click **Load more** until the oldest entry on the page is earlier than the start of the period the examiner asked for.
3. Click **CSV**. The file is named like `sentinel-audit-log-all-2026-10-16.csv`.
4. Open the file in a spreadsheet and remove the rows outside the period, if the examiner asked for a set period.

The CSV has these columns:

```text
Time (UTC), Who, Actor type, Action, Target type, Target id, Details
```

Times in the file are in UTC, which is three hours behind Kenya time. **Action** holds the system code (for example `review.confirm` for an approval), not the plain-English label. **Details** holds the full record of the entry, including the before and after values of a settings change.

![CSV button and the Load more button at the foot of the log](/help/shots/a10-export.png "TODO")

### The monthly compliance pack

For a summary rather than a line-by-line record, use the **Reports** page. Choose a month and click **Download (PDF)**. The pack shows checks by outcome, AML hits, review cases and turnaround, decisions per person and the reasons used, monitoring and STRs. It is available to Admins, Reviewers and Viewer / Auditors.

## What each result means

These are some of the entries you will see most often under **What**:

| Entry | What it means |
|---|---|
| **Ran a check** | A person or API key started a check. |
| **Recommended a decision** | Someone sent a recommendation that needs a second person (four-eyes). |
| **Approved a case** / **Rejected a case** | The final decision on a review case, with its reason and notes. |
| **Sent a recommendation back** | A second approver returned a recommendation, with their reason. |
| **Escalated a case** | A team member asked for a senior decision. |
| **Case missed its deadline** | Sentinel flagged a case as overdue. "Who" is "Sentinel". |
| **Changed the review workflow** (and other "Changed ..." entries) | An Admin saved a Settings tab. The CSV shows the before and after values. |
| **Changed a role** / **Deactivated a member** | An Admin changed someone's access. |
| **Created an API key** / **Revoked an API key** | Someone managed your API keys. |
| **Disputed a result** | Your team asked DeepTrack's review team to look at a result again. |
| "No entries yet." / "No entries of this kind yet." | Nothing matches the filter in the entries loaded so far. Try **Load more** or **Everything**. |

An entry with no plain-English label shows its system code instead.

## Common questions

### Can anyone change or delete an audit entry?

No. Entries are written at the same moment as the change they describe. Sentinel has no way to edit or delete them, for your team or for DeepTrack.

### How long is the audit log kept?

For as long as your organization uses Sentinel. When old checks are removed after your retention period, their audit entries stay. See [A11 Data retention and data requests](/help/a11).

### Can I give an examiner their own access?

Yes. Invite them with the **Viewer / Auditor** role. They can read the log, cases and reports but can't change anything. Deactivate them when the examination ends. See [A5 Team members and roles](/help/a5).

### Why is the time different in the CSV?

The page shows times in your browser's time zone. The CSV uses UTC so the file means the same thing wherever it is opened. Add three hours for East Africa Time.

### Does the log show what someone only looked at?

No. The log records actions that change something, such as decisions, settings and checks. Opening a case or a report is not recorded.

### Does downloading the log cost credits?

No. Reading and downloading the audit log has no charge.

## Related chapters

- [A5 Team members and roles](/help/a5)
- [A6 Security and single sign-on](/help/a6)
- [A8 Review rules](/help/a8)
- [A11 Data retention and data requests](/help/a11)
- [B11 Deciding a review case](/help/b11)
- [B14 Filing an STR or SAR](/help/b14)
- [B15 Disputes](/help/b15)
