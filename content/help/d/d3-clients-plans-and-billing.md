---
id: d3
title: Clients, plans and billing
summary: Set up and change client accounts, add credits, issue and reconcile invoices, set the USD to KES rate, and watch client health.
roles: Internal admin, Internal reviewer
---

## What it's for

Three Back Office screens cover a client's commercial life:

- **Client accounts**: create a client, change its plan, status, currency and limits, invite its first Admin, and add or remove credits.
- **Revenue & billing**: usage and revenue, low balances, the price list, the USD to KES rate, monthly statements and invoices. Click an invoice number to open the printable invoice page.
- **Client health**: usage trends, onboarding progress, API keys, integration errors and client teams.

Keep two numbers apart. **Revenue** on these screens is the value of credits clients *used* (charges less refunds), priced on each client's plan when the check ran. **Cash** is what clients *paid*, which is the **Paid** invoices. A client who prepays Growth and runs nothing shows cash but no revenue.

Clients are billed in KES (Kenyan organizations, 1 credit = KES 40, plan bonus credits of 10%, 15% or 20%) or USD (1 credit = US$0.01, cheaper checks on bigger plans). Plans are priced in US dollars. A KES client paying online pays the USD price at the USD to KES rate you set here. This is what clients read in A2.

## Who can use it

| Screen | Who can view | Who can act |
| --- | --- | --- |
| **Client accounts** | Internal admins and internal reviewers | Internal admins without view-only. Everyone else sees **read only** and no forms. |
| **Revenue & billing** | Internal admins and internal reviewers | Internal admins without view-only: **Save rate**, **Mark paid**, **Cancel**, **Issue invoice**, invoice details **Save**. |
| Invoice page | Internal admins, including view-only | Nobody edits here. **Download** and **Print** only. |
| **Client health** | Internal admins and internal reviewers | Read only for everyone. |

Internal admins hold the Auth0 role internal_admin, administrator, head or admin. Internal reviewers hold reviewer, compliance_analyst or compliance_reviewer. The view_only modifier removes every action above. Every change is written to the audit log with your name and the reason you gave.

## Step by step

### Create a client

Self-service trials create themselves (see "Trials" below). Use this for clients signed by sales.

1. Open **Client accounts** and click **New client**.
2. Fill in **Organization name**, **Plan** (default **Trial**), **Billing currency** (Kenyan entities KES, everyone else USD) and **Requests per minute** (default 60).
3. Check **Starting credits / limit**. For a paid plan it is filled in with the plan's annual credits. These credits are added straight away, with no invoice. If the client still has to pay, set it to 0 and issue a plan invoice instead (below).
4. Click **Create client**. The new client opens on the right.
5. Under **Invite a team member**, enter the client's compliance lead, for example faith.otieno@client.co.ke, leave **Role** on **Admin** and click **Send invitation**. From then on the client's Admin manages their own team (A5).

For a KES client, the prefilled credits use the Back Office KES list price, not the USD price at today's rate. Agree the figure with sales.

![Client accounts with Demo Bank Ltd selected](/help/shots/d3-client-accounts.png "TODO")

### Change a client's account

1. In **All clients**, click the client. Use **Search client name or id…** for long lists.
2. Under **Account settings**, change what you need:
   - **Plan** changes the price of every future check at once. It adds no credits and raises no invoice.
   - **Status**: **active**, **suspended** or **trial expired**. Suspended and expired clients cannot start checks, and a suspended client cannot pay online.
   - **Billing currency** can change only while the balance is exactly 0. Bring it to 0 with an adjustment first.
   - **Monthly credit limit** drives the usage bar and the Overview alerts. It adds no credits.
   - **Alert threshold %** (1 to 100) is the usage level that raises an alert.
   - **Requests per minute** (1 to 100,000) caps the client's API traffic.
   - **Team seats** limits active members plus pending invites. Leave it empty for no limit.
3. Enter **Reason (audit log)**, for example "Upgraded to Growth per contract DT-SA-014".
4. Click **Save changes**. The message lists what changed, or says **Nothing changed.**

The client's API keys are also limited per key by plan: Trial 10, Starter 60, Growth 200, Business 500 and Enterprise 1,000 requests a minute. **Requests per minute** applies on top, so setting it above the plan limit has no effect on a single key.

### Add or remove credits

1. Under **Add or adjust credits**, choose **Type**:
   - **Allocation (add plan credits)**: credits under a contract or a payment made outside Sentinel.
   - **Refund (give credits back)**: credits for a check that should not have been charged. A refund lowers the client's usage and revenue figures.
   - **Adjustment (add or remove)**: corrections. A negative amount removes credits.
2. Enter **Amount**, a whole number up to 10,000,000. The balance cannot go below 0.
3. Enter **Reason (audit log + ledger)**, for example "Refund for duplicate check, ticket 4471".
4. Click **Apply** and confirm. The new balance shows, and the line appears under **Credit ledger**. The client sees it in their credit history as **Credits added**, **Refund** or **Adjustment**.

### Issue an invoice and record a bank or M-Pesa payment

1. Open **Revenue & billing** and scroll to **Issue an invoice**.
2. Choose the client, then **Plan prepayment** and the plan, or **Other charge** with **Description**, **Amount** and **Credits to add**.
3. Set **Due in (days)** (default 14, up to 90) and click **Issue invoice**. It is numbered like `DT-2026-0042` and is in the client's billing currency.
4. When money arrives in the bank or on the M-Pesa paybill with that number as reference, find the invoice under **Unpaid invoices** and click **Mark paid**.
5. Type `bank_transfer`, `mpesa` or `other`, then the bank or M-Pesa transaction code.

The credits are added at once. A plan invoice also moves the client to that plan. Any payment by a trial client makes it a Starter client and reactivates it. A suspended client stays suspended.

To cancel an unpaid invoice, click **Cancel** and give a reason. The reason is printed on the invoice, and the client can read it.

![Unpaid invoices with Mark paid and Cancel](/help/shots/d3-invoices.png "TODO")

### Reconcile Paystack payments

Card and mobile money payments settle themselves. Paystack's webhook tells Sentinel, and every 10 minutes Sentinel also asks Paystack about any payment between 3 minutes and 48 hours old. A successful payment marks its invoice **Paid** with method Paystack. A checkout abandoned for a day is closed.

Sentinel's Paystack references start with `snt-`, and each transaction carries the invoice number in its metadata. To reconcile:

1. In Paystack, list successful Sentinel transactions for the period.
2. In **Revenue & billing**, choose the client under **Invoices** and check each one is **Paid · paystack**.
3. If Paystack shows a success but the invoice is still **Unpaid** after an hour, check the amount and currency. Sentinel refuses a payment that does not match the invoice exactly. If it matches, click **Mark paid**, choose `other` and enter the Paystack reference.
4. A reversed or charged-back payment does not remove credits. Remove them with an **Adjustment** and explain why in the reason.

### Set the USD to KES rate

1. Under **Price list**, enter the rate in **USD → KES rate (for combined revenue only)**, for example 129.5.
2. Click **Save rate**.

Despite the label, the rate also prices every KES plan bought online: Growth at 130 is KES 715,000. Without a rate, KES clients see **Ask for a quote**. Invoices already issued keep their old price. Cancel stale unpaid plan invoices after a big change.

Under **On every invoice**, keep DeepTrack's company name, address, KRA PIN, **VAT %** and **How to pay** up to date, then click **Save**. Each invoice copies these details when it is issued.

![Revenue & billing tiles and price list](/help/shots/d3-billing.png "TODO")

### Trials

There is no approval step. Anyone with a verified work email can start a 14-day trial (A1). They get 25 credits (KES) or 1,000 credits (USD), a 30-requests-a-minute cap and Trial pricing, which is the same as Starter. Internal admins get an email headed "New Sentinel trial" with the company and Admin's email.

Every day at 08:00 Nairobi time, trials past their end date move to **trial expired**. Setting **Status** back to **active** lasts only until the next morning, because the trial end date cannot be changed here. If sales agrees to give more time, change **Plan** to **Starter** and **Status** to **active**, and add credits as an **Allocation**. A **Trial** client you create yourself has no end date and never expires.

### Monthly statements

Under **Monthly statement**, pick the client and month. Click **CSV** for finance, or **Print / PDF**. **Amount** is charges less refunds in the client's currency.

### Client health

1. Open **Client health**. Read the tiles: **Clients live**, **Usage dropping**, **Integration errors, 7 days** and **API keys needing attention**.
2. In **Usage trend**, click a client name to open it in **Client accounts**.
3. Use **Onboarding** to find clients stuck before **Live verification** or **First charge**, and pass them to their account manager.

![Client health with usage trend and onboarding](/help/shots/d3-client-health.png "TODO")

### The demo client

Demo Bank Ltd is DeepTrack's invented client for the manual and training videos. It is on Business, billed in KES, with a 300-requests-a-minute cap, a balance of 5,000,000 credits and no monthly credit limit, so its usage shows as a dash. Its checks are never charged, so it adds no revenue. Do not edit it, add credits or invoice it. Engineering builds and resets it.

### Recurring tasks

- [ ] Daily: Match bank and M-Pesa receipts against **Unpaid invoices** and click **Mark paid** for each.
- [ ] Daily: Check **Running out within 7 days** and **Low balance forecast**, and tell each client's account manager.
- [ ] Daily: Read new-trial emails and check the new client in **Client accounts**.
- [ ] Weekly: Reconcile Paystack's successful transactions against **Paid · paystack** invoices.
- [ ] Weekly: Chase **Overdue** invoices, and cancel any the client will not pay, with a reason.
- [ ] Weekly: In **Client health**, follow up every **usage dropping** client and every client with 5xx errors.
- [ ] Monthly: Update the USD to KES rate with the rate finance has set.
- [ ] Monthly: Export each paying client's **Monthly statement** as CSV for finance.

## What each result means

| What you see | Where | What it means | What to do |
| --- | --- | --- | --- |
| **active** / **suspended** / **trial expired** | Client status | Can run checks / blocked by DeepTrack / trial ended. | Suspend only on instruction from compliance or finance. |
| Red balance | Client accounts | 0 credits or fewer. New checks are refused. | Tell the account manager, or issue an invoice. |
| **Unpaid** / **Overdue** | Invoices | Waiting for payment / past its due date. | Chase, then **Mark paid** or **Cancel**. |
| **Paid · mpesa** (or bank transfer, paystack, other) | Invoices | Paid, credits added. | Nothing. |
| **Cancelled** | Invoices | Cancelled by DeepTrack. Nothing is owed. | Nothing. |
| **Paystack not configured** | Invoices panel | Online payment is off. Clients can only pay by bank or M-Pesa. | Tell engineering. |
| **Unbilled work** | Revenue & billing | Checks waiting in review, charged when the review is resolved. | Work the review queue (D2). |
| **usage dropping** | Client health | Last 14 days at half or less of the 14 days before, from at least 10 checks. | Ask the account manager to call. |
| **never used**, **idle N days**, **due for rotation** | API keys | Unused key, unused 30+ days, or older than 180 days. | Suggest the client revokes or rotates it. |
| **429** errors | Integration errors | The client hit its rate limit. | Raise **Requests per minute** or move them to a bigger plan. |

## Common questions

### Why does Revenue this month not match what we were paid?

Revenue counts credits used, not money received. Prepayments and top-ups show as **Paid** invoices, and become revenue only as the client runs checks.

### Can I extend a trial?

Not directly. Move the client to **Starter**, set it **active** and add credits as an **Allocation**. Reactivating it as a trial lasts only until the next morning.

### Why can't I invite a member to this client?

Invitations need an **active** client. Reactivate it first, or check its **Team seats** limit.

### Can I undo a credit change?

Yes. Apply an **Adjustment** with the opposite amount and say why. Both lines stay in the ledger and the audit log.

### Can I change a client from USD to KES?

Only at a balance of 0. Note the balance, remove it with an **Adjustment**, change the currency, then add the equivalent credits on the new price list as an **Allocation**.

## Related chapters

- [D1 The Back Office at a glance](/internal-ops/help/d1)
- [D2 Review queue and disputes](/internal-ops/help/d2)
- [A1 Signing up and your free trial](/help/a1)
- [A2 Choosing a plan and paying](/help/a2)
- [A5 Team members and roles](/help/a5)
- [A12 Usage and reports](/help/a12)
