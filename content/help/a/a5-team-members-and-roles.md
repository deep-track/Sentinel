---
id: a5
title: Team members and roles
summary: Invite your colleagues, give each one the right role and review queues, and deactivate people who leave.
roles: Admin
---

## What it's for

Everyone who uses Sentinel for your organization is a team member with one role. The role decides what they can see and do. You manage the team in **Settings** → **Team**.

From this page you can:

- invite people by email and choose their role
- change a member's role
- choose which review queues a member gets cases from
- deactivate someone who leaves, and reactivate or remove them later

Every change is recorded in the audit log, with who made it and when.

## Who can use it

- Only an **Admin** can invite people, change roles, set review queues and deactivate members.
- Everyone else who opens **Settings** → **Team** sees the **Roles** guide only, with the note "Only your organization's Admin can invite people and change roles. Ask them if you need access for someone."
- Your team always keeps at least one active Admin. Sentinel won't let you deactivate the last Admin or change their role until someone else is an Admin.

### The roles

| Role | Typical person | In short |
|---|---|---|
| **Admin** | CRO, Head of Compliance | Everything: team, rules, security, API keys, billing, and any case decision. |
| **Reviewer** | Senior compliance officer, MLRO | Everything an Analyst can, plus final approval of cases your rules reserve for senior staff, and STRs. |
| **Analyst** | Compliance analyst | Runs checks, investigates, adds notes, decides standard cases and recommends decisions on the rest. |
| **Developer** | IT or integration staff | API keys, webhooks and test mode. Can run checks, but doesn't review cases. |
| **Viewer / Auditor** | Internal audit, a regulator visit | Read-only: checks, cases, reports and the audit log. |

### What each role can do

"View" means the person can open and read it. "Act" means they can make changes.

| Area | Admin | Reviewer | Analyst | Developer | Viewer / Auditor |
|---|---|---|---|---|---|
| Run checks (KYC, KYB, documents, AML, liveness) and send capture links | Yes | Yes | Yes | Yes | No |
| Read checks and their reports | Yes | Yes | Yes | Yes | Yes |
| Reviews: view the queue and cases | Yes | Yes | Yes | No | Yes |
| Reviews: take, recommend and decide cases | Yes | Yes | Yes | No | No |
| Reviews: assign a case to someone else | Yes | Yes | No | No | No |
| Customer risk: mark a periodic review done | Yes | Yes | Yes | No | No |
| Transactions: upload | Yes | Yes | Yes | Yes | No |
| Transactions: decide an alert | Yes | Yes | Yes | No | No |
| Prepare and file STRs, see the STR register | Yes | Yes | No | No | No |
| Open or withdraw a dispute | Yes | Yes | Yes | No | No |
| Forget a cleared AML hit | Yes | Yes | No | No | No |
| Monthly compliance pack (**Reports**) | Yes | Yes | No | No | Yes |
| Create, rotate and revoke API keys; manage webhooks | Yes | No | No | Yes | No |
| Resend a webhook | Yes | Yes | Yes | Yes | No |
| Audit log: view and export | Yes | Yes | Yes | No | Yes |
| Billing: view | Yes | Yes | Yes | Yes | Yes |
| Billing: pay invoices, change payment options | Yes | No | No | No | No |
| Settings: read | Yes | Yes | Yes | Yes | Yes |
| Settings: change, including team and security | Yes | No | No | No | No |

Who makes the *final* decision on each kind of review case is set separately, in **Settings** → **Review workflow**. By default a sanctions hit needs an Admin, and most other high-risk cases need a Reviewer or above. See [A8 Review rules](/help/a8).

## Step by step

### Invite a team member

1. Click **Settings** in the sidebar, then the **Team** tab.
2. Under **Invite a team member**, check the seat bar. It shows **Seats used (members + pending invitations)**, for example "3 of 5". If your plan has no seat limit, you see a count instead.
3. In **Email**, type the person's work address, for example `wanjiku.kamau@demo-bank.example`.
4. In **Role**, choose the role. **Analyst** is selected by default.
5. Click **Invite**.

![Settings, Team tab for Demo Bank Ltd with the invite form and seat bar](/help/shots/a5-invite.png)

Sentinel emails the invitation. The person joins your team the first time they sign in to Sentinel with that address. Their email must be verified when they sign in, so nobody can join by typing someone else's address.

If the email couldn't be sent, you see a warning, and the invitation is still saved. Ask the person to sign in to Sentinel with that exact email to join.

### Manage pending invitations

Pending invitations appear under **Pending invitations**, with the role, who invited them, and the expiry date.

1. Invitations expire after 7 days. To renew one, invite the same email again. You can choose a different role when you do.
2. To cancel one, click **Revoke** and confirm. The invitation link stops working straight away.

### Change a member's role

1. In the **Members** table, find the person.
2. Choose the new role from the list in the **Role** column. The change saves at once and applies to their next action.

### Choose a member's review queues

Admins, Reviewers and Analysts receive review cases. Developers and Viewers show "Doesn't review".

1. In the **Review queues** column, click the summary (for example **All queues**).
2. Tick the queues this person should get cases from: **KYC**, **AML**, **IDP**, **KYB** or **Liveness**.
3. Leave all of them unticked to give the person every queue.

This matters when cases are assigned automatically. For example, if Otieno Odhiambo only has **AML** ticked, he only receives AML cases.

### Deactivate someone who leaves

1. In the **Access** column, click **Deactivate** next to the person.
2. Confirm. They lose access right away. Their open cases go back to the unassigned queue so nobody's work is lost.

![Members table with one active Admin and one deactivated Analyst](/help/shots/a5-members.png "TODO")

You can't deactivate yourself. Another Admin must do it.

A deactivated member stays in the list, greyed out, with the date. Their decisions and audit history are kept. You then have two buttons:

- **Reactivate** gives them access again with the same role, if you have a free seat.
- **Remove** takes them off the list. Their decisions and audit history are still kept.

### Work in more than one organization

Some people belong to more than one organization in Sentinel, for example a group compliance officer who covers a bank and its microfinance arm.

1. The top of the sidebar shows the organization you are working in, and your role there.
2. If you belong to several, click it. Under **Organizations**, choose the one you want.
3. Every page, including **Settings**, now shows that organization. Your role can be different in each one.

![Organization switcher in the sidebar, open on the Organizations list](/help/shots/a5-switcher.png)

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| **Email sent** | The invitation email went out. | Wait for them to sign in. |
| **Email not sent** | The invitation is saved, but the email failed. | Ask them to sign in to Sentinel with that email, or invite again later to resend. |
| "(you)" next to a name | This row is you. | You can't deactivate yourself. |
| "Outside your allowed email domains" | This member's email isn't on the list in **Settings** → **Security** → **Allowed email domains**. | Check that they should still have access. Deactivate them if not. |
| "Deactivated" with a date | The member has no access. | **Reactivate** or **Remove** as needed. |
| **Last seen** "Never" | They haven't used Sentinel yet. | Check they received the invitation. |
| **Cases** | How many closed review cases they decided, approved or recommended. | Use it to see who carries the review load. |
| "All seats are in use." | Members plus pending invitations have reached your plan's limit. | Deactivate a member, revoke an invitation, or ask DeepTrack for more seats. |

## Common questions

### Does a pending invitation use a seat?

Yes. A seat is used by every active member and every unexpired pending invitation. Deactivated members don't use a seat.

### Can I invite someone with a Gmail address?

Only if your **Allowed email domains** list is empty. If your Admin has set domains there, for example `demo-bank.example`, only addresses at those domains can be invited. See [A6 Security and single sign-on](/help/a6).

### What happens to a person's open cases when I deactivate them?

Cases assigned to them go back to the unassigned queue. Closed cases keep their name as the decision-maker.

### Can I see who changed someone's role?

Yes. Invitations, role changes, queue changes, deactivations and removals are all in the audit log. See [A10 The audit log](/help/a10).

### Can someone join without an invitation?

Only through single sign-on, if your Admin has chosen a role under **New people who sign in with SSO**. Otherwise every new person needs an invitation.

### How do I add more seats?

Your seat limit comes with your plan. Contact DeepTrack to change it.

## Related chapters

- [A1 Signing up and your free trial](/help/a1)
- [A4 Your organization profile](/help/a4)
- [A6 Security and single sign-on](/help/a6)
- [A8 Review rules](/help/a8)
- [A10 The audit log](/help/a10)
- [B11 Deciding a review case](/help/b11)
