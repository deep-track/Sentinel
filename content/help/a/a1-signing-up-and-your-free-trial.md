---
id: a1
title: Signing up and your free trial
summary: Sign up for Sentinel with your work email, start a 14-day free trial with free credits, and sign in to your new workspace for the first time.
roles: Admin
---

## What it's for

You can try Sentinel without talking to anyone first. You sign up with your work email, set a password, and start a free trial. The trial gives you:

- A new Sentinel workspace for your organization, with you as its **Admin**.
- 14 days to try every product: KYC identity checks, AML screening and monitoring, document checks and business (KYB) checks.
- Free credits to run real checks. A Kenyan organization gets 25 credits, which is about 25 KYC or AML checks. An organization outside Kenya gets 1,000 credits, worth US$10.

No card is needed. Your country decides your billing currency: Kenyan organizations are billed in Kenya shillings (KES), everyone else in US dollars (USD). Checks during the trial cost the same as on the Starter plan (see A2).

## Who can use it

Anyone with a work email address can sign up. Personal mailboxes such as Gmail, Yahoo, Outlook or iCloud cannot start a trial.

Each organization gets one trial. Sentinel recognises your organization by the domain of your email, for example `kcbgroup.co.ke`. If a colleague with the same email domain has already started a trial, you cannot start a second one. Ask them to invite you instead (see A5).

The person who starts the trial becomes the workspace's **Admin**. Everyone in the workspace sees the trial banner.

## Step by step

### Sign up

1. Go to the sign-up page at `/signup`. The page is headed **Start your free Sentinel trial**.
2. Fill in:
   - **Full name**, for example Wanjiku Kamau.
   - **Work email**, for example wanjiku.kamau@yoursacco.co.ke.
   - **Organization**, the name of your bank, SACCO, microfinance or fintech.
   - **Country**. Kenya is selected for you.
3. Click **Start free trial**.

![Sign-up form filled in for a Kenyan SACCO](/help/shots/a1-signup.png)

4. The form changes to **Check your inbox**. DeepTrack sends an invitation email to the address you entered.

If you see **Almost there** instead, no email was sent. Click **Sign in** and sign in with the same work email.

If the form also says that someone at your organization already started a trial, stop here and ask that person to invite you from **Settings → Team**.

### Set your password and sign in

1. Open the invitation email and follow the link.
2. Set your password. If you are asked to verify your email address, do that first.
3. You are signed in and taken to the **Sentinel access** page, headed **Access is being prepared**. This is normal: your account exists, but it does not belong to a workspace yet.

### Start the trial

On the same page, a box headed **Start your free 14-day trial** appears.

1. Check **Organization**. Sentinel fills it in from the sign-up form. It becomes your organization's legal name in **Settings → Organization** (see A4). You can change it there later.
2. Check **Country**. This sets your billing currency. You cannot change the currency yourself afterwards, so choose carefully.
3. Optionally, enter **Phone (optional)**, for example +254 712 345 678. It is saved as your compliance contact phone.
4. Tick the box to accept DeepTrack's terms of service and privacy policy and confirm you can act for your organization.
5. Click **Start free trial**.

![Start your free 14-day trial box on the access page](/help/shots/a1-start-trial.png "TODO")

Sentinel creates your workspace, adds the free credits and opens the **Dashboard** (see A3). Your name and email are saved as the compliance contact in **Settings → Organization**. DeepTrack's team is told that your trial has started, so someone may get in touch.

### During the trial

A banner at the top of every page shows how long you have left, for example:

```text
Free trial: 9 days and 18 credits left. Top up to keep going after the trial
```

![Trial banner above the dashboard](/help/shots/a1-trial-banner.png "TODO")

Use the trial to:

1. Complete your organization profile (A4).
2. Invite your team (A5).
3. Run a few real checks, such as a KYC identity check on a colleague (B2).

### When the trial ends

If you use up your free credits before the 14 days are over, new checks are refused until you top up. The banner still counts down the days.

After 14 days, Sentinel ends the trial within a day. New checks stop, and the banner turns red and says **Your free trial has ended, so new checks are paused. Your results and settings are kept.** Your team also gets a **Your Sentinel trial has ended** notification.

To carry on, click **Top up to continue** and pay on the **Billing & Credits** page (see A2). The first payment moves your workspace to the Starter plan, or to the plan you bought, and checks start again straight away.

## What each result means

| What you see | Where | What it means | What to do |
| --- | --- | --- | --- |
| **Check your inbox** | Sign-up form | Your request is saved and the invitation email is on its way. | Open the email and set your password. |
| **Almost there** | Sign-up form | Your request is saved, but no email was sent. | Click **Sign in** and use the same work email. |
| **Access is being prepared** | Access page | You are signed in, but you do not belong to a workspace yet. | Start a trial, or ask your Admin to invite you. |
| **Access service unavailable** | Access page | Sentinel could not check your access just now. | Click **Try again** after a few minutes. |
| Trial banner with days and credits left | Every page | Your trial is running. | Top up any time to keep going after the trial. |
| Red banner: trial has ended | Every page | New checks are paused. You can still read everything. | Click **Top up to continue**. |

If the access page does not offer a trial, it shows a reason instead:

| Message | What to do |
| --- | --- |
| Verify your email address first | Open the verification email, then sign in again. |
| Free trials need a work email address | Sign in with your work email, or contact DeepTrack sales. |
| Someone at your domain already started a trial | Ask them to invite you from **Settings → Team**. |
| You've already started a trial | Ask that workspace's Admin to invite you. |
| You already belong to a workspace | Click **Try again** to open it. |

## Common questions

### How many checks can I run in the trial?

Trial checks are charged at Starter prices. In KES, a KYC identity check, AML screening or document check costs 1 credit, so 25 credits is about 25 checks. A business (KYB) check costs 5. In USD, 1,000 credits covers about 7 KYC checks or 16 AML screenings. See A2 for the full price list.

### Why can't I sign up with my Gmail address?

Trials need a work email so that each organization gets one trial and DeepTrack knows who it is working with. If your organization has no email domain of its own, contact DeepTrack sales.

### Do I lose my results when the trial ends?

No. Your checks, reports, cases and settings are kept, and everyone can still read them. Only new checks are paused until you pay.

### Can I extend the trial?

Not from the portal. Make any payment on the **Billing & Credits** page to continue, or contact DeepTrack sales.

### I asked for a sign-up email more than once. Why was I refused?

Sentinel accepts three sign-up requests per email address a day. Check your inbox and spam folder for the invitation, or try again the next day.

### Is there a limit on API use during the trial?

Yes. Each API key on a trial can make 10 requests a minute, and the whole workspace up to 30 a minute across its keys. That is enough to test an integration but not to run production volumes.

## Related chapters

- [A2 Choosing a plan and paying](/help/a2)
- [A3 The dashboard at a glance](/help/a3)
- [A4 Your organization profile](/help/a4)
- [A5 Team members and roles](/help/a5)
- [A6 Security and single sign-on](/help/a6)
- [B2 KYC identity checks](/help/b2)
- [C1 Quick start](/help/c1)
