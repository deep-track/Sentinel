---
id: d1
title: The Back Office at a glance
summary: Get into the Sentinel Back Office, read the cross-client Overview, and move between clients and the client portal.
roles: Internal admin, Internal reviewer
---

## What it's for

The Sentinel Back Office is DeepTrack's own console. It shows every client organization at once: their accounts and credits, the checks they run, the shared review queue, and the health of the service behind them. Clients never see it.

The **Overview** is the landing screen. It answers four questions in one place: are our clients able to run checks, how busy is the platform today, what is waiting in the review queue, and is anything broken.

## Who can use it

Access comes from your Auth0 roles, not from a client membership. Sentinel reads them when you sign in.

| Auth0 role | Treated as | In the Back Office |
|---|---|---|
| internal_admin, administrator, head, admin | Internal admin | Can view every screen and act on them, including client accounts. In the client portal, can open any active client as its **Admin**. |
| reviewer, compliance_analyst, compliance_reviewer | Internal reviewer | Can view every screen and work the review queue. Can't make admin-only changes, such as reassigning another reviewer's item. |
| view_only (added to either of the above) | View only | Can view, but every change is refused with "This account is view-only and can't make changes." |

On the **Overview** itself, everyone with an internal role can view, and there is nothing to act on.

If you sign in without an internal role, opening `/internal-ops` sends you back to the client dashboard. If you aren't signed in, you go to the sign-in page. In production, the Back Office returns "not found" when Auth0 sign-in isn't set up, so it can never open without an access check.

Ask an internal admin to add or remove your Auth0 role. Changes apply the next time you sign in.

## Step by step

### Open the Back Office

1. Sign in to Sentinel as usual.
2. In the client app sidebar, click **Sentinel Back Office**. This link only shows for internal roles.
3. Sentinel opens the **Overview**.

You can also go straight to `/internal-ops`. It always opens the **Overview**.

### Read the sidebar

1. Check the amber strip down the left edge and the amber banner **Internal — not client visible**. These tell you that you are in the Back Office, not in a client's portal. Never share a screenshot of these screens with a client.
2. If the banner also says "(local dev: access check skipped)", you are on a developer's machine without sign-in. This never shows in production.
3. The menu is grouped into **Back office**, **Clients**, **Reviews** and **Risk & compliance**. The page you are on is highlighted with a blue dot.
4. At the bottom you see your name and your role. "· view only" after the role means you have the view-only modifier.

![Back Office sidebar with the amber banner and the Reviews section](/help/shots/d1-sidebar.png)

### Read the Overview

1. The top bar shows **Overview**, "Cross-client · live", and a status line on the right. Figures update on their own; you don't need to reload.
2. Read the five tiles:
   - **Active clients**, with how many are suspended or have an expired trial.
   - **Scans today**, with the change against yesterday.
   - **Credits consumed** today across all plans (deductions minus refunds).
   - **In review queue**, with how many are client disputes.
   - **Open alerts**, with how many are critical.
3. **Client accounts** lists the first 8 clients by name, with plan, monthly credit usage, balance and status. Click **Manage all** for the full list.
4. **System alerts** lists up to 8 alerts, critical first.
5. **Global verification log** shows the 10 most recent checks across all clients, with verdict, confidence and how long each took.
6. **Review queue** shows up to 10 open items, highest priority first. Click **Open review queue** to work them (see [D2 Review queue and disputes](/internal-ops/help/d2)).
7. The footer gives today's average and p95 (95th percentile: 95% of checks finished faster than this) verification time.

"Today" starts at midnight in your browser's time zone. If you work from outside East Africa, your "today" differs from the client's.

![Back Office Overview with Demo Bank Ltd in Client accounts and the James Mutua dispute in the Review queue](/help/shots/d1-overview.png "TODO")

### Move between clients

1. To look at one client's account, click its name in **Client accounts**. The **Client accounts** screen opens with that client selected.
2. To see the client's own portal, click **Back to dashboard** at the bottom of the menu.
3. In the client app, open the organization switcher at the top of the sidebar and pick the client, for example **Demo Bank Ltd**.

Internal admins see every active client in the switcher. You act as that client's **Admin**, or as **Viewer / Auditor** if you have the view-only modifier. Suspended and trial-expired clients are not listed. Internal reviewers only see organizations they have been added to as a member.

Anything you do in a client's portal is recorded in that client's audit log as an internal admin, and the client can read it there.

![Organization switcher listing client organizations](/help/shots/d1-switcher.png)

### Recurring tasks

- [ ] Daily: Open the Overview at the start of the day and clear or hand on every critical alert.
- [ ] Daily: Check **In review queue** and the number of client disputes, then work the queue (see D2).
- [ ] Daily: Look for clients with a red balance or a usage bar near its threshold, and tell their account manager.
- [ ] Weekly: Compare **Scans today** with the same day last week to spot a client whose volume has dropped.
- [ ] Monthly: Ask an internal admin to review who holds internal Auth0 roles and remove leavers.

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| Green "all checks nominal" | No open alerts. | Nothing. |
| Amber "N open alerts" | Only warnings are open. | Read them today. |
| Red "N critical alerts" | At least one critical alert. | Act now. |
| "... watchlist unavailable" (critical) | A sanctions or PEP list has not been loaded. AML screenings are held for manual review until it is. | Check **Service health** and tell engineering. Expect the review queue to grow. |
| "... watchlist is stale" (warning) | A list hasn't refreshed on time. AML screenings are held for manual review until it does. | Check **Service health**. |
| "Client — 0 credits left" (critical) | An active client has no balance. New checks are refused. | Contact the client about a top-up. |
| "Client — N% of monthly credits consumed" | Usage has passed the client's alert threshold. Critical at 100% or more. | Warn the client before they run out. |
| "Client — account suspended" / "trial expired" | The client can't run checks. | Confirm with billing that this is intended. |
| Status **active**, **suspended**, **trial expired** | The client account's status. | See **Client accounts**. |
| "figures cover the most recent 10,000 verifications" | Today's figures hit a read limit and leave out older rows. | Treat the counts as a minimum. |

## Common questions

### Can a client ever see the Back Office?

No. Client users have no Auth0 role, so the link is hidden and the screens send them back to their dashboard. Every figure behind the Back Office also checks for an internal role on its own.

### What does the view-only modifier change?

You can open every screen, but any change is refused. In a client's portal you act as **Viewer / Auditor**, not **Admin**.

### Why isn't a client listed in the organization switcher?

Internal admins only see active clients. A suspended or trial-expired client still shows on **Client accounts** in the Back Office.

### Why does Scans today look low?

Your day starts at midnight in your browser's time zone. If you are travelling, the boundary moves with you.

### Is what I do in a client's portal recorded?

Yes. It is written to that client's audit log as an internal admin action, and the client's Admin can read it.

## Related chapters

- [D2 Review queue and disputes](/internal-ops/help/d2)
- [A3 The dashboard at a glance](/help/a3)
- [A5 Team members and roles](/help/a5)
- [A10 The audit log](/help/a10)
- [B15 Disputes](/help/b15)
