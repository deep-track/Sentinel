---
id: b3
title: Capture links: KYC on the customer's phone
summary: Send a customer a KYC link by WhatsApp or SMS, or copy it, in English or Kiswahili, and follow it until the check comes back.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

A capture link lets a customer do their own KYC identity check on their phone. You don't need their photos in advance. You send them a secure link. They open it, agree to the consent text, photograph their ID, take a selfie and type any details you didn't fill in. Their submission becomes an ordinary KYC check under **Identity (KYC)**, with the same steps and results. See [B2 KYC identity checks](/help/b2).

Use it for customers who open an account remotely, for example through an agent, a call centre or a mobile loan app.

Each link:

- works once, and for 72 hours
- opens in English or Kiswahili, and the customer can switch language on the page
- needs no app and no account

## Who can use it

- **Admin**, **Analyst**, **Reviewer** and **Developer** can create, send and cancel links.
- **Viewer / Auditor** can see the list of links but not create or cancel them.

## Step by step

### Send a link

1. Click **Identity (KYC)** in the sidebar, then **Send capture link**. The **Capture links** page opens.
2. Choose how to send it: **WhatsApp**, **SMS** or **Copy link**.
3. Choose the language of the message and the customer's page: **English** or **Kiswahili**.
4. For WhatsApp or SMS, type the **Customer's mobile number** in international format, for example +254712345678.
5. Optional: fill in **Customer details**: **First name**, **Last name**, **ID or passport number**, **Date of birth** and **Gender**. The customer isn't asked again for anything you fill in, and what you fill in wins over what they type. Only the first name shows on their page.
6. Optional: add **Your reference**, for example your customer number CUST-20431. It shows in the list and is saved with the check.
7. Click **Send link** (WhatsApp or SMS) or **Create link** (Copy link).

![Capture links page with WhatsApp and Kiswahili selected](/help/shots/b3-capture-form.png)

For WhatsApp or SMS you see "Link queued for WhatsApp." (or SMS). The message reads, in English: "Demo Bank Ltd asks you to verify your identity. Open this secure link within 72 hours:" followed by the link. The Kiswahili message says the same.

For **Copy link**, Sentinel copies the link to your clipboard and shows it once under "Copy it now: it isn't shown again." Paste it into your own chat or email. If you lose it, create a new link.

### What the customer sees

The page is headed "Verify your identity", or "Thibitisha utambulisho wako" in Kiswahili. If you filled in a first name, it greets them by name.

1. **Consent**: the page says which organization is asking and that it takes about 3 minutes. The consent text cites the Kenya Data Protection Act, 2019. The customer taps **I agree, start**.
2. **Document**: they choose **National ID card**, **Passport** or **Driving licence**.
3. **Photos**: they photograph the front of the document, then the back (not for a passport), then take a selfie. Each step has **Take photo**, **Retake** and **Continue**. Sentinel shrinks each photo so it uploads on a slow connection.
4. **Details**: if you left any details blank, they type them in. Gender offers Male or Female.
5. They tap **Submit** and see "Thank you".

The language link at the top right switches between English and Kiswahili at any time.

![The customer's page in Kiswahili, greeting Halima](/help/shots/b3-customer-intro.png "TODO")

### Track your links

The list under the form shows your 50 most recent links. Each row shows the customer's name (or number, or "Shared link"), your reference, how it was sent, the language and when. A status badge shows how far the customer got. Once they submit, the row links to the KYC check by its reference.

![Capture links list with Joseph's and Halima's links](/help/shots/b3-capture-list.png)

To stop a link before the customer uses it, click **Cancel** on its row. The customer then sees "This link was cancelled."

## What each result means

| Status | What it means | What to do |
|---|---|---|
| **Sent** | The link was created (and sent, for WhatsApp or SMS). The customer hasn't opened it yet. | Wait, or remind the customer. |
| **Opened** | The customer opened the page but hasn't submitted. | Wait. They may be finding their ID or better light. |
| **Submitted** | The customer sent their photos. The row links to the KYC check. | Open the check and read its result. See [B2](/help/b2). |
| **Expired** | 72 hours passed without a submission. Any details you filled in are deleted. | Send a new link if you still need the check. |
| **Cancelled** | Someone on your team cancelled the link. | Nothing. |
| not delivered: ... | Shown in red next to a WhatsApp or SMS row: the message could not be sent, with the reason. | Check the number, or use **Copy link** and send it yourself. |

## Common questions

### How much does a capture link cost?

Sending the link is free. When the customer submits, it becomes a KYC check and is charged like one: 1 credit on KES plans, or your plan's price on USD plans. See [A12 Usage and reports](/help/a12).

### Can the customer prove liveness through the link?

No. The link takes a still selfie, which is checked by DeepTrack Live and compared with the ID photo. It can't prove the person was present. So a check from a capture link that passes everything else ends in **Needs Review**. To confirm presence, also send a liveness link. See [B4 Remote liveness](/help/b4).

### How many links can we send?

Up to 3 links an hour to the same number. Your organization can send about 100 links an hour. If you go over, you see "Too many links to this number. Try again later." or "Too many capture links. Try again later."

### What if the customer's submission fails?

Their page says "That didn't work. Check your connection and try again." They can try again a few times on the same link. If your organization is out of credits, the submission can't go through. Ask your Admin to top up in **Billing & Credits**.

### Can the customer use the link twice?

No. After one submission the link shows "This link has already been used." Send a new link for a second attempt.

### Who can see the customer's details?

The customer's page never shows the ID number or other details you filled in, only the first name. After submission, the details move to the KYC check and follow its retention period.

## Related chapters

- [B2 KYC identity checks](/help/b2)
- [B4 Remote liveness](/help/b4)
- [B9 Reading a report and its PDF](/help/b9)
- [B11 Deciding a review case](/help/b11)
- [A12 Usage and reports](/help/a12)
