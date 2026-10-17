---
id: a2
title: Choosing a plan and paying
summary: Choose a Sentinel plan, top up credits by Paystack, bank transfer or M-Pesa, download invoices and receipts, and set up automatic top-up.
roles: Admin
---

## What it's for

Sentinel runs on credits. Each check costs a set number of credits, charged only when the check completes. You buy credits in two ways:

- **A plan.** You pay a year in advance and get credits for that amount. Bigger plans cost less per check.
- **A top-up.** You buy more credits at any time, at your plan's prices.

Everything about money is on the **Billing & Credits** page in the sidebar: your plan, balance, prices, plans, top-ups, invoices and the credit history.

### Your currency

Your billing currency is set when your workspace is created. Kenyan organizations pay in Kenya shillings (KES). Everyone else pays in US dollars (USD).

| | KES | USD |
| --- | --- | --- |
| One credit | KES 40 | US$0.01 |
| How bigger plans save | Bonus credits on every payment: Growth 10%, Business 15%, Enterprise 20% | Fewer credits per check |
| KYC identity check (Starter) | 1 credit | 130 credits |
| AML screening and monitoring (Starter) | 1 credit | 60 credits |
| Enhanced KYB (Starter) | 5 credits | 200 credits |

The **Your prices** table on the page shows the exact price of every check on your current plan.

### The plans

| Plan | Price a year | How you buy it |
| --- | --- | --- |
| Starter | US$2,500 | On the Billing page |
| Growth | US$5,500 | On the Billing page |
| Business | US$12,000 | On the Billing page |
| Enterprise | Custom | **Speak to us** |

Plan prices are shown in US dollars. If you pay in KES, you pay the equivalent in shillings at the exchange rate DeepTrack sets, and the card shows the amount as **Paid as KES ...**. For example, at KES 130 to the dollar, Growth costs KES 715,000. That buys 17,875 credits, plus the 10% Growth bonus, so 19,662 credits.

## Who can use it

Everyone in your organization can open **Billing & Credits** and see the plan, balance, prices, invoices and credit history.

Only **Admins** can buy a plan, top up, pay an invoice, save a card, set up automatic top-up or change the billing settings. Other roles see the line **Only Admins can change the plan.** and no payment buttons.

An Admin can still pay after a trial ends, so the workspace can start again. A suspended account cannot pay online. Contact DeepTrack.

## Step by step

### Check your plan and balance

1. Click **Billing & Credits** in the sidebar.
2. Read the two cards at the top:
   - **Current plan**: your plan, your currency, the value of one credit and any plan bonus.
   - **Credit balance**: credits left and what they are worth.

If the balance is 0 or less, it turns red and says **New verifications are refused until credits are added. Top up below.**

![Billing & Credits page for Demo Bank Ltd on the Business plan](/help/shots/a2-billing.png "TODO")

### Before you pay: billing settings

Fill these in once, at the bottom of the page under **Billing settings**:

1. **Billing email (receipts and payment links)**, for example finance@yoursacco.co.ke. If you leave it empty, Paystack uses your own sign-in email.
2. **KRA PIN (shown on invoices)**, for example P051234567X. It is printed on every invoice so you can claim VAT.
3. Click **Save billing settings**.

The invoice also shows your organization's legal name and address from **Settings → Organization** (see A4).

### Choose a plan

1. Scroll to **Plans**. Your current plan is marked **Current**.
2. On the plan you want, choose how to pay:
   - **Choose and pay** (or **Renew** for your current plan) opens Paystack's checkout.
   - **Pay by bank / M-Pesa** creates an invoice for you to pay by bank transfer or M-Pesa paybill.
3. For Enterprise, click **Speak to us**. This opens an email to DeepTrack's sales team. Enterprise is arranged by contract, not bought online.

If a KES plan shows **Ask for a quote** instead, DeepTrack has not set the exchange rate yet. Click it to email sales for an invoice. If online payment is not set up, only **Pay by bank / M-Pesa** is shown.

![Plans with Growth marked Popular](/help/shots/a2-plans.png "TODO")

When the payment for a plan is received, your workspace moves to that plan straight away and the plan's credits are added.

### Top up credits

1. Under **Top up credits**, click one of the suggested amounts or type an amount in **Amount (KES)** or **Amount (USD)**.
   - KES: from KES 1,000 to KES 5,000,000. Suggestions are KES 4,000, 20,000, 100,000 and 400,000.
   - USD: from US$50 to US$50,000. Suggestions are US$100, 500, 1,000 and 5,000.
2. Leave **Save the card for automatic top-ups** ticked if you want to use automatic top-up later.
3. Click **Pay**. Paystack's checkout opens.
4. Pay by card or mobile money, such as M-Pesa, on Paystack.
5. Paystack sends you back to **Billing & Credits**. Sentinel confirms the payment, adds the credits and downloads your receipt as a PDF.

A KES top-up buys whole credits, so the amount is rounded down to a multiple of KES 40. On Growth, Business and Enterprise, your plan bonus is added to top-ups too. Taxes, if any, are added on the invoice.

If the page says **Payment is still processing**, wait. Sentinel keeps checking with Paystack and adds the credits as soon as the payment is confirmed.

### Pay by bank transfer or M-Pesa paybill

1. Click **Pay by bank / M-Pesa** on a plan. The invoice opens.
2. Read **How to pay**. It gives DeepTrack's bank and M-Pesa paybill details.
3. Pay, and use the invoice number, for example `DT-2026-0042`, as the payment reference (the account number for M-Pesa).
4. DeepTrack's team matches the payment and marks the invoice paid. The credits are added then.

You have 14 days to pay. Clicking **Pay by bank / M-Pesa** again opens the same unpaid invoice, shown as **Open the unpaid invoice**.

### Invoices and receipts

Every payment has an invoice. They are listed under **Invoices**, newest first, with the date, kind (**Top-up**, **Plan** or **Charge**), credits and total.

1. Click **View** to open the invoice page. From there, click **Download invoice (PDF)**, **Download receipt (PDF)** once paid, or **Print**.
2. Or click **PDF** (unpaid) or **Receipt** (paid) in the list to download it directly.
3. To pay an unpaid invoice online, click **Pay**.

![A paid invoice with the Paid stamp](/help/shots/a2-invoice.png "TODO")

### Automatic top-up

Automatic top-up charges your saved card when your balance runs low, so checks never stop.

1. Pay one top-up or plan by card with **Save the card for automatic top-ups** ticked. Mobile money payments cannot be saved.
2. Under **Billing settings**, **Automatic top-up** now shows your saved card.
3. Tick **Charge the card when the balance falls to**, then enter the balance in credits (default 100) and the amount to charge.
4. Click **Save billing settings**.

Sentinel charges the card at most once every 12 hours. If the card is declined, you get an **Automatic top-up failed** notification. To stop, untick the box, or click **Remove** next to the card.

## What each result means

| Invoice status | What it means | What to do |
| --- | --- | --- |
| **Unpaid** | Issued, waiting for payment. Due 14 days after issue. | Pay online with **Pay**, or by bank or M-Pesa using the invoice number. |
| **Paid** | Payment received. Credits added. The PDF is your receipt. | Download the **Receipt** for your finance team. |
| **Cancelled** | DeepTrack cancelled the invoice. Nothing is owed. | Nothing. Ask DeepTrack if you are unsure why. |

Invoices marked **automatic** were raised by automatic top-up. An invoice headed **Tax invoice** includes VAT.

| Credit history line | What it means |
| --- | --- |
| **Credits added** | Credits from a payment, a plan or the free trial. |
| **Charge** | A check that completed. Click its reference to open the check. |
| **Refund** | Credits given back. |
| **Adjustment** | A correction made by DeepTrack's team. |

## Common questions

### When am I charged for a check?

When the check completes. A remote liveness check is the exception: it is charged when the invitation is sent to the customer. AML monitoring of a screened customer is included in the screening price.

### What happens when I run out of credits?

New checks are refused until you add credits. Everything you have already done stays available. Set a warning level in **Settings → Notifications** under **Low-credit warning** to get an alert before that happens.

### Do unused credits expire?

No. Sentinel does not remove unused credits from your balance.

### Can I pay with M-Pesa?

Yes, two ways: through Paystack's checkout as mobile money, or to DeepTrack's paybill using the details on the invoice. Only card payments can be used for automatic top-up.

### Can I change plans during the year?

Buy the new plan from **Plans**. When it is paid, your workspace moves to it and its credits are added to your balance. For anything else, such as a refund, speak to DeepTrack's sales team.

## Related chapters

- [A1 Signing up and your free trial](/help/a1)
- [A4 Your organization profile](/help/a4)
- [A5 Team members and roles](/help/a5)
- [A10 The audit log](/help/a10)
- [A12 Usage and reports](/help/a12)
- [C6 Results and credits](/help/c6)
