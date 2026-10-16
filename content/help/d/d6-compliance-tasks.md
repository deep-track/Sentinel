---
id: d6
title: Compliance tasks
summary: Log and track data subject requests, approve a client's removal of old records, sign off the weekly report and read the risk dashboard.
roles: Internal admin, Internal reviewer
---

## What it's for

DeepTrack processes personal data for its clients. Under the Kenya Data Protection Act, the client is the data controller: it answers its own customers. Clients are told (in A11) that if they need DeepTrack to act on a specific record, DeepTrack's review team logs the request and tracks it to a deadline. This chapter is how you do that, and the other compliance work that runs through the Back Office:

- **Data subject requests.** A person's rights to see their data (access), have it deleted (erasure), have it corrected (rectification) or stop its use (objection). You log each request that reaches DeepTrack and move it to a close.
- **Data removals.** Sentinel never deletes records on its own. A client Admin requests removal of records past the client's retention period, and a second person approves. When a client has only one Admin, that second person is a DeepTrack internal admin.
- **Weekly compliance report.** Generated every Monday. Someone downloads it and signs it off.
- **The risk dashboard.** Sanctions and PEP (politically exposed person: someone who holds or held a prominent public role) hits, fake faces caught and outcomes across all clients for the last 13 weeks.

## Who can use it

Back Office access comes from Auth0 roles. Internal admins hold internal_admin, administrator, head or admin. Internal reviewers hold reviewer, compliance_analyst or compliance_reviewer. The view_only role removes write access from an internal admin.

| Screen | Who can view | Who can act |
|---|---|---|
| **Compliance** (audit log, weekly reports, data subject requests, records by age) | Internal admins and internal reviewers, including view-only accounts | Internal admins without view_only: **Sign off**, **Log request** and the status dropdown. Others see the status as a badge and no form. |
| **Risk** | Internal admins and internal reviewers | Nobody. The screen is read-only. |
| Client **Settings** → **Audit & data** → **Data retention** | Internal admins, after switching to the client | Internal admins without view_only can approve or cancel. A view-only admin enters the client as a viewer and doesn't see the section. Internal reviewers can't open client settings. |

Every write on these screens is checked again on the server and written to the audit log.

## Step by step

### Log a data subject request

1. In the Back Office sidebar, under **Risk & compliance**, click **Compliance**.
2. Scroll to **Data subject requests**. The header shows how many are open and how many are past due.
3. In the form under the table, pick the type: **Access**, **Erasure**, **Rectification** or **Objection**.
4. In the subject field, type the verification reference, for example `ver_8f2k4m1q9z7c3b5d`. The field says "Verification reference (not the person's details)". Never type the person's name or ID number here.
5. Set the date received. It can't be in the future.
6. In the days field, set **Days to respond**. The default is 30. Use the deadline your legal team confirms under the Data Protection Act.
7. The form has no client field. In **Notes (optional)**, write the client's name and how the request arrived, for example "Demo Bank Ltd, email from compliance officer".
8. Click **Log request**. The button stays grey until the subject has at least 3 characters.

![Data subject requests with one open erasure request and the form below](/help/shots/d6-requests.png "TODO")

### Work a request to a close

1. Change the row's status to **In progress** when you start.
2. Do the work:
   - **Access:** open the check through the client's portal and download its report (see [B9 Reading a report and its PDF](/help/b9)). Send it to the client, not to the person.
   - **Rectification:** a finished check isn't edited. The client runs a new check with the correct details.
   - **Erasure or objection:** checks inside the client's retention period are kept, because POCAMLA requires seven years. Checks past the period go through a data removal (below). There is no button that deletes a single check; erasures outside that flow are done by hand, and this log is the record.
3. Set the status to **Completed** or **Rejected**. Sentinel stamps the completion time.

You can't edit a request's notes after logging it, so write the full context when you log it.

### Approve a client's data removal

1. Find waiting requests. On **Compliance**, in **Audit log**, set the period to **Last 7 days** and the action to `retention.purge_requested`. The **Client** column names the client. A client may also ask you directly.
2. Confirm with the client in writing that they want DeepTrack to approve.
3. Click **Back to dashboard** at the bottom of the Back Office sidebar. In the organization switcher at the top of the portal sidebar, pick the client under **Organizations**. Only active clients are listed.
4. Click **Settings**, then the **Audit & data** tab. Scroll to **Data retention**.
5. Under **Removal waiting for approval**, check who asked, the cutoff date and how many checks and transactions it covers.
6. Click **Approve removal** and confirm. You see "Removal approved. It runs in the background."
7. While it runs, the section shows "Removing personal data" with a count. When it finishes, the removal moves to **Removal history**.
8. Switch back to your usual organization.

To stop a request instead, click **Cancel**. You can't approve a request you made yourself.

![Removal waiting for approval in a client's Audit & data settings](/help/shots/d6-removal-pending.png "TODO")

### Sign off the weekly compliance report

1. On **Compliance**, find **Weekly compliance reports**. A report covers the 7 days before it was generated.
2. Click **Download** and read it.
3. Click **Sign off**. Add optional notes for the audit trail and click OK. The row shows **signed off**, your name and the date.

### Read the risk dashboard

1. Under **Risk & compliance**, click **Risk**.
2. Read the four tiles: **Watchlist hits**, **Critical hits**, **Rejected verifications** and **Fake faces caught**.
3. Check **Watchlist hits per week** for a jump in one list.
4. Use **Hits by client**, **Hits by list**, **Hits by matched country** and **Top programmes and topics** to see where hits come from.
5. In **Fake faces caught**, each row gives the client, **Scan ID**, whether it came from a **Selfie** or **Liveness video**, the confidence and the outcome. In Demo Bank Ltd, James Mutua's KYC check shows a fake selfie at 94.0%.

![Risk dashboard with one fake face caught for Demo Bank Ltd](/help/shots/d6-risk.png "TODO")

### Recurring tasks

- [ ] Daily: on **Compliance**, check **Data subject requests** for any **overdue** badge.
- [ ] Daily: filter the audit log by `retention.purge_requested` and act on any request a client asked DeepTrack to approve.
- [ ] Daily: on **Risk**, look at **Critical hits** and **Fake faces caught** and make sure each is in a review case (see D2).
- [ ] Weekly: on Monday after 07:30 EAT (04:30 UTC), download and sign off the new weekly compliance report.
- [ ] Weekly: compare **Hits by client** with last week and raise any sharp change with the account owner.
- [ ] Monthly: read **Records by age** and remind clients with older records about their retention period (A11).

## What each result means

### Data subject requests

| Status | Meaning | What to do |
|---|---|---|
| **Open** | Logged, not started. | Start it before the due date. |
| **In progress** | Someone is working on it. | Finish and close it. |
| **Completed** | Done. | Nothing. |
| **Rejected** | Refused, for example because POCAMLA requires keeping the record. | Make sure the client told the person why. |
| **overdue** (red, in **Due**) | Open or in progress, and past its due date. | Escalate today. |

### Records by age

Counts all clients' verifications **Under 6 months**, **6–12 months**, **1–2 years** and **Over 2 years**. A count with "+" is over 10,000. The note under it, "Sentinel has no automatic retention limit yet", is out of date: each client has a retention period of at least 84 months, and removals work as above.

### Weekly reports

- **not signed off** (amber): completed and waiting for you.
- **signed off** (green): done, with who and when.
- **failed** (red): the report didn't build. It has no **Download** or **Sign off**. Tell engineering on-call.

The verification count covers every check type. **Pass · review · reject** counts AML screenings only.

### Risk tiles

- **Watchlist hits**: every sanctions, PEP, adverse media and Kenyan list hit in 13 weeks, and how many verifications they touch.
- **Critical hits**: strong sanctions matches. Each needs a decided review case.
- **Rejected verifications**: all check types.
- **Fake faces caught**: DeepTrack Live judged a selfie or liveness video fake. The table shows the newest 25.

## Common questions

### Should a data subject request go to DeepTrack or the client?

To the client, which is the data controller. You log it here when a client asks DeepTrack to act on a record, or when a person writes to DeepTrack directly; in that case, tell the client.

### Can we delete one customer's check on request?

Not from any screen. A check inside the retention period is kept under POCAMLA. A check past the period goes in the client's next removal.

### Who approves a removal when the client has two Admins?

The second client Admin. DeepTrack approves only when the client asks, usually because it has one Admin.

### Can a removal be undone?

No. You can cancel only while it is waiting for approval. See [A11 Data retention and data requests](/help/a11) for what is kept.

### Can a client see our data subject request log?

No. The log, the Risk screen and the Back Office audit view are internal. The client sees its own audit log, including your approval of its removal.

### Why does a held record still show after the removal?

Checks with an open case, active monitoring or an STR are kept, and so are transactions on an open alert. The history line starting "Kept:" says why. See [B7 Ongoing monitoring](/help/b7).

## Related chapters

- [D1 The Back Office at a glance](/internal-ops/help/d1)
- [D2 Review queue and disputes](/internal-ops/help/d2)
- [D3 Clients, plans and billing](/internal-ops/help/d3)
- [D7 Platform health and quality](/internal-ops/help/d7)
- [A10 The audit log](/help/a10)
- [A11 Data retention and data requests](/help/a11)
- [B7 Ongoing monitoring](/help/b7)
- [B10 Fraud signals explained](/help/b10)
