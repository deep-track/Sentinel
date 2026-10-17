---
id: b4
title: Remote liveness
summary: Send a customer a liveness link by SMS or WhatsApp and follow the result, to confirm a real person was in front of the camera.
roles: Admin, Reviewer, Analyst, Developer, Viewer / Auditor
---

## What it's for

A liveness check confirms that a real, live person was in front of the camera, not a printed photo, a screen replay or a deepfake (a video faked with AI). A still selfie can't prove this. That is why a KYC check from **New Verification** or a capture link ends in **Needs Review** even when everything else passes. See [B2 KYC identity checks](/help/b2).

With remote liveness, you send the customer a link. They open it on their phone and do a short camera check. The result comes back to Sentinel.

Use it when:

- a KYC check is in review only because liveness wasn't collected
- you want to confirm presence before a high-risk action, such as raising a loan limit or changing the phone number on an M-Pesa-linked account

## Who can use it

- **Admin**, **Analyst**, **Reviewer** and **Developer** can send liveness links.
- **Viewer / Auditor** can see the list of sent requests. In place of the form they see "Your role can view liveness requests but not send new ones."
- Your own team decides liveness results that need review, in **Reviews**. See [B11 Deciding a review case](/help/b11).

## Step by step

### Send a liveness link

1. Click **Liveness** in the sidebar. The **Liveness** page opens.
2. Under **Send a liveness verification link**, type the **End user's mobile number** in international format, for example +254722000111. Spaces and dashes are fine.
3. Under **Send via**, choose **SMS** or **WhatsApp**.
4. Click **Send verification link**.

![Liveness page with the Send a liveness verification link form](/help/shots/b4-liveness-form.png)

You see "Liveness link queued for delivery." The customer gets this message: "Complete your Deeptrack liveness verification:" followed by the link. The message is in English only.

If the number isn't in international format, you see "Enter the phone number in international format, e.g. +254700000000." Fix it and send again.

### Follow the request

The **Sent requests** list on the same page shows your 50 most recent requests, newest first. Each row has the **Contact**, the **Method**, the **Status** and when it was **Sent**. The list updates by itself, so you can leave the page open.

![Sent requests list on the Liveness page](/help/shots/b4-sent-requests.png "TODO")

If a request shows **failed**, hold the pointer over the badge to see why, for example "Liveness link undelivered: Message could not be delivered."

### Read the result

When the customer finishes, the request shows **completed**, and Sentinel records a liveness check with its own verdict:

1. Click **Overview** in the sidebar. In **Recent verifications**, find the row with type **Liveness**. The **Verdict** column shows the result.
2. If the verdict is **needs review**, the check is also in **Reviews**. Choose the **Liveness** queue to find it, then decide it. See [B11 Deciding a review case](/help/b11).

A liveness check is separate from any KYC check. Sentinel doesn't attach it to the customer's KYC report. When you decide a KYC case that was held because liveness wasn't collected, note the liveness check's reference in your decision.

## What each result means

### Request status on the Liveness page

| Status | What it means | What to do |
|---|---|---|
| **pending** | The link was sent and the customer hasn't finished yet. | Wait, or remind the customer. |
| **completed** | The customer finished the camera check. | Read the verdict on **Overview**, or decide it in **Reviews**. |
| **failed** | The message couldn't be delivered, or the check couldn't be completed. The reason shows when you hold the pointer over the badge. | Check the number, try the other method, or send again. |

### Verdict of the liveness check

| Verdict | What it means | What to do |
|---|---|---|
| **approved** | A live person was confirmed. | Use it as liveness evidence under your policy. |
| **needs review** | The result wasn't clear enough to decide automatically, or no verdict came back. | Decide the case in **Reviews**. |
| **rejected** | The customer didn't pass the liveness check. | Don't treat the customer as verified. Follow your fraud procedure. See [B10 Fraud signals explained](/help/b10). |
| **failed** | The link was never delivered, or the check couldn't be completed. | Send a new link. |

## Common questions

### How much does a liveness check cost?

1 credit on KES plans. On USD plans the price depends on your plan. It is charged when the SMS or WhatsApp provider accepts the message, even if the customer never opens the link. If the message can't be sent at all, it isn't charged. See [A12 Usage and reports](/help/a12).

### Can I send the link by email?

No. Liveness links go by SMS or WhatsApp only.

### How many links can I send to one customer?

Up to 3 an hour to the same number. Your organization can send about 60 an hour in total. If you go over, you see "Too many invitations to this number. Try again later." or "Too many liveness invitations. Try again later."

### What if the customer has no smartphone?

The link opens on the customer's phone and uses its camera, so a basic phone can't do it. Follow your policy for customers you can't verify remotely, for example a visit to a branch.

### Does a liveness check update the KYC result?

No. The two checks stay separate. Your reviewer uses the liveness result as evidence when deciding the KYC case in **Reviews**.

## Related chapters

- [B1 How Sentinel decides](/help/b1)
- [B2 KYC identity checks](/help/b2)
- [B3 Capture links: KYC on the customer's phone](/help/b3)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [A12 Usage and reports](/help/a12)
- [C2 KYC API](/help/c2)
