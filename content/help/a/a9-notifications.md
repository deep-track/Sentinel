---
id: a9
title: Notifications
summary: Choose which events alert your team, which roles get each alert, and which alerts also go by email.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

Sentinel alerts your team when something needs attention: a sanctions hit, a case waiting for approval, a missed deadline, a low credit balance. Every alert appears in the bell at the top of Sentinel and on the **Notifications** page. An alert can also go by email.

As Admin, you decide in **Settings** → **Notifications**:

- which alerts are on,
- which alerts are also emailed,
- which roles get each alert,
- the credit balance that triggers the low-credit warning.

## Who can use it

- Only an **Admin** can change the notification settings. Everyone else can open **Settings** → **Notifications** and read them, with the controls greyed out.
- Every member, whatever their role, has their own bell and **Notifications** page. Each person sees only the alerts sent to them.
- Alerts go only to active members. A deactivated member gets nothing new.

## Step by step

### Choose the alerts

1. Click **Settings** in the sidebar, then the **Notifications** tab.
2. In the **Alerts** table, each row is one alert. For each one:
   - Tick **On** to send it. Untick it to stop it for everyone.
   - Tick **Email** to send it by email as well as in the bell. **Email** is greyed out while the alert is off.
   - Under **Who gets it**, tick the roles that should get it: **Admin**, **Reviewer**, **Analyst**, **Developer** or **Viewer / Auditor**.
3. Click **Save changes**.

![Alerts table in Settings, Notifications for Demo Bank Ltd](/help/shots/a9-alerts-table.png "TODO")

Two alerts go to named people, not to roles. You can turn them on or off and choose email, but you can't pick roles:

- **Case assigned** goes to the person a case is assigned to. It is also used when a second approver sends a recommendation back to the person who made it.
- **Awaiting approval** goes to the people who can approve a recommendation: active members with clearance for that kind of case, leaving out the person who recommended it and, under maker-checker, the person who ran the check. See [A8 Review rules](/help/a8).

### The alerts and their defaults

| Alert | When it is sent | Email | Who gets it by default |
|---|---|---|---|
| **Sanctions hit** | A review case opens for a sanctions match. | Yes | Admin, Reviewer |
| **PEP hit** | A review case opens for a PEP (politically exposed person) match. | Yes | Admin, Reviewer |
| **High-risk case** | Another review case opens with high priority. | No | Admin, Reviewer |
| **Case assigned** | A case is assigned to someone, or their recommendation is sent back. | Yes | That person |
| **Awaiting approval** | Someone sends a recommendation that needs a second person. | Yes | People who can approve it |
| **Missed review deadline** | A case passes its deadline without a decision. Sent once per case. | Yes | Admin, Reviewer |
| **Case escalated** | A team member escalates a case for a senior decision. | Yes | Admin, Reviewer |
| **Monitoring alert** | Ongoing monitoring finds a new or more severe hit. | Yes | Admin, Reviewer, Analyst |
| **Low credits** | The credit balance falls to your warning level. | Yes | Admin |
| **Webhook paused** | A webhook endpoint kept failing and Sentinel paused it. | Yes | Admin, Developer |
| **Dispute decided** | DeepTrack's review team decides a result your team disputed. | Yes | Admin, Reviewer, Analyst |
| **Periodic reviews due** | Monitored customers reach their review date. One alert a day lists them, and a customer is listed again after 30 days if still due. | Yes | Admin, Reviewer, Analyst |
| **Transaction alerts** | Transaction monitoring raises an alert on a customer's transactions. | Yes | Admin, Reviewer, Analyst |

A new case sends only one of **Monitoring alert**, **Sanctions hit**, **PEP hit** and **High-risk case**. **Monitoring alert** comes first, then **Sanctions hit**, then **PEP hit**, then **High-risk case**. A sanctions case for Viktor Petrovich Orlov sends **Sanctions hit**, not **High-risk case** as well.

### Set the low-credit warning

1. In **Low-credit warning**, leave **Use your plan's warning level** ticked to use the level that comes with your plan. The label shows that level in credits.
2. To set your own level, untick it and enter a number in **Warn at (credits)**.
3. Click **Save changes**.

The **Low credits** alert goes out once when the balance falls to that level. It goes out again only after a top-up takes the balance back above it. When the balance reaches zero, the alert says "Out of credits" and new checks are refused until you top up.

### Read your notifications

1. Look at the bell at the top of any page. A red number shows how many alerts you haven't read. Above 99 it shows "99+".
2. Click the bell to open the **Notifications** page. Unread alerts are in bold with a dot.
3. Click an alert to open what it is about, such as the case, **Customer risk** or **Billing & Credits**. This marks it read.
4. Click **Mark all read** to clear the count.

![Notifications page with unread case alerts](/help/shots/a9-inbox.png "TODO")

If you belong to more than one organization, the page shows alerts from all of them, with the organization's name under each one.

### What the email looks like

The subject starts with "[Sentinel]" followed by the alert title, for example "[Sentinel] PEP hit: Daniel Kipruto Langat". The email has the same text as the alert and an **Open in Sentinel** button. It goes to the email address on the person's Sentinel account.

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| Red number on the bell | You have unread alerts. | Open the **Notifications** page. |
| "No notifications yet." | No alerts have been sent to you. | Nothing. Check the settings if you expected some. |
| "All read" | Every alert in your list is read. | Nothing. |
| **Email** greyed out | The alert is off. | Tick **On** first. |
| "Settings saved" | Your changes apply to the next alerts. | Nothing. |
| "The low-credit warning must be a whole number from 0 to 100000000." | The level you entered isn't valid. | Enter a whole number. |

## Common questions

### Can a person turn off an alert just for themselves?

No. The Admin sets alerts for the whole organization, by role. If someone gets too many, change the roles for that alert.

### Why didn't I get an email?

Check that **Email** is ticked for that alert and that your role is ticked under **Who gets it**. The alert still appears in your bell. If it is there but the email isn't, check your spam folder and the email address on your account.

### If I turn off Awaiting approval, will cases still need a second person?

Yes. Notifications never change the review rules. Approvers just won't be told. They can still find the case under **Awaiting my approval** on the **Reviews** page.

### How many notifications does the page keep?

The **Notifications** page shows your latest 50. Older alerts are not shown there, but every case decision and settings change is kept in the audit log. See [A10 The audit log](/help/a10).

### Do alerts cost credits?

No. In-app alerts and emails have no charge.

### Do notifications replace webhooks?

No. Notifications are for people. Your systems should use webhooks, which also send a credits-low event. See [C7 Webhooks](/help/c7).

## Related chapters

- [A5 Team members and roles](/help/a5)
- [A8 Review rules](/help/a8)
- [A10 The audit log](/help/a10)
- [B7 Ongoing monitoring](/help/b7)
- [B11 Deciding a review case](/help/b11)
- [B13 Transaction monitoring](/help/b13)
- [B15 Disputes](/help/b15)
- [C7 Webhooks](/help/c7)
