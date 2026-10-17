---
id: a7
title: Screening rules
summary: Set how Sentinel screens and checks your customers: match threshold, PEP classes, monitoring, adverse media, face match, fraud network and document rules.
roles: Admin
---

## What it's for

**Screening rules** holds the rules Sentinel applies to your checks: which AML hits count, which PEP hits are urgent, how often monitored customers are screened again, how face match and the fraud network behave, and what happens to a forged document.

A new organization starts with Sentinel's standard rules, so nothing changes until you save here. Each rule below gives its default.

## Who can use it

- Every member can read the rules. Anyone who isn't an Admin sees "Only your organization's Admin can change these settings." and greyed-out fields.
- Only an **Admin** can save changes. Each save is recorded in the audit log.
- In the cleared hits list, an **Admin** or **Reviewer** can click **Forget**. Other roles see the list but can't forget a hit.

## Step by step

### Change a rule

1. Click **Settings** in the sidebar, then the **Screening rules** tab.
2. Change the rules you need. The page is in sections, described below.
3. At the bottom, the bar shows "You have unsaved changes." Click **Save changes**, or **Discard** to go back to the saved rules.
4. If a value is out of range, Sentinel refuses the save and names the field, for example "The match threshold must be a whole number from 70 to 95."

![Screening rules page with the AML matching section](/help/shots/a7-aml-matching.png)

### AML matching

| Setting | Default | Options | What changes |
|---|---|---|---|
| **Match threshold** | 70% | Slider, 70% to 95% | Hits scoring below it don't count, on sanctions, PEP, watchlist and Kenyan lists, and in ongoing monitoring. Raising it cuts false positives but can miss spelling variants and transliterations. Kenyan register and risk-list hits need at least 85 whatever you set. |
| **High-risk PEP classes** | Class 1 and Class 2 | Any of Class 1 to Class 4, or none | A case with a PEP hit in a ticked class opens as high priority, so it gets your shortest review deadline. All PEP cases still follow your PEP clearance and four-eyes rules ([A8](/help/a8)). |

The four classes are: Class 1, national or head of state level; Class 2, regional, diplomatic or senior military; Class 3, state-owned enterprise, international organisation, party or local government; Class 4, family member or close associate. A PEP is a politically exposed person: someone who holds or held a prominent public role.

### False-positive memory

| Setting | Default | What changes |
|---|---|---|
| **Don't raise cleared hits again** | On | When a reviewer approves an AML case, its hits are remembered as cleared for that customer. Later screenings and monitoring leave them out, unless the hit becomes more severe: a new risk category, a more senior PEP class, or critical. Off: every hit is raised every time. |

This only works for customers identified by more than a name: a customer reference, ID or registration number, or date of birth. A hit cleared for one Wanjiku Kamau is never hidden for another.

Below the switch is the list of cleared hits, newest first, up to 200. It shows the **Customer**, the **Cleared hit** with its source and PEP class, who cleared it and when, and **Not raised**: how many times it has been left out since. To bring a hit back:

1. Click **Forget** on its row.
2. Confirm. You see "Forgotten: it will be raised again". The next screening of that customer raises it.

![Cleared hits list under False-positive memory](/help/shots/a7-cleared-hits.png "TODO")

### AI hit review

| Setting | Default | What changes |
|---|---|---|
| **Review hits with AI when a case opens** | On | When an AML case with hits opens, Sentinel's AI compares the customer with each hit (date of birth, nationality, ID number, positions, the news story) and recommends clearing, confirming or getting more information, with reasons. Off: nothing runs on its own, but reviewers can still click **Review the hits with AI** in the case. |

The AI only recommends. Your reviewers decide, under your four-eyes and clearance rules. ID numbers are compared by Sentinel itself and never sent to the AI.

### Face match and duplicate faces

| Setting | Default | What changes |
|---|---|---|
| **Compare the selfie with the ID photo** | On | In KYC checks, the selfie (or the liveness photo) is compared with the ID photo. A clear match changes nothing; an unclear result, a mismatch or a missing face holds the check for review. Face match never rejects on its own. The images are compared and discarded. Off: the report shows face match as **Not run**. |
| **Search for the same face among your customers** | Off | Looks for the same face among your earlier KYC checks under a different identity. Only available while face match is on. |

When duplicate search is on, Sentinel keeps a face template (not the photo) for each KYC check, in a collection only your organization's checks use. It is deleted with the check under your retention period. Face templates are biometric data. Make sure your privacy notice and customer consent cover this before you turn it on.

### Fraud network

| Setting | Default | What changes |
|---|---|---|
| **Join the Sentinel network** | Off | Off: ID numbers, document numbers, phone numbers and emails are compared only with your own checks. On: they are also compared with checks of other organizations that joined, and theirs with yours. |

Either way, Sentinel keeps only keyed fingerprints, never the numbers, names or dates themselves. Nobody is told which organization saw an identifier. A strong signal sends a pass to review; it never rejects on its own. See [B10 Fraud signals explained](/help/b10).

![Face match and Fraud network sections](/help/shots/a7-face-fraud.png)

### Customer risk rating and periodic review

| Setting | Default | Range |
|---|---|---|
| **High risk: review every (months)** | 12 | 1 to 60 |
| **Medium risk: review every (months)** | 24 | 1 to 60 |
| **Low risk: review every (months)** | 36 | 1 to 120 |

High-risk customers must be reviewed at least as often as medium-risk ones, or the save is refused. A shorter period brings a monitored customer's next review forward the next time they are rated. A longer one applies from their next completed review. See [B12 Customer risk and periodic reviews](/help/b12).

### Transaction monitoring

Thresholds are in US dollars. For customers rated high risk, the minimums are halved and so is the velocity multiple (to at least 2). FATF countries and sanctioned counterparties have no thresholds. See [B13 Transaction monitoring](/help/b13).

| Rule | Field | Default | Range |
|---|---|---|---|
| Large cash | **Threshold (US$)** | 15,000 | 1,000 to 15,000 |
| Structuring | **Band from (% of threshold)** | 70 | 50 to 95 |
| | **Transactions** | 3 | 2 to 20 |
| | **Within (days)** | 7 | 1 to 30 |
| Unusual activity (velocity) | **Times usual volume** | 5 | 2 to 50 |
| | **Minimum (US$)** | 5,000 | 100 to 1,000,000 |
| Money in and straight out (pass-through) | **Out (% of inflows)** | 90 | 50 to 100 |
| | **Within (hours)** | 48 | 1 to 168 |
| | **Minimum inflows (US$)** | 10,000 | 100 to 1,000,000 |
| Dormant account reactivated | **Dormant for (days)** | 180 | 30 to 730 |
| | **Minimum (US$)** | 5,000 | 100 to 1,000,000 |

The large cash threshold can be lowered, not raised above the US$15,000 reporting threshold.

### Ongoing monitoring

| Setting | Default | Options | What changes |
|---|---|---|---|
| **Monitor every new AML screening by default** | Off | On or off | On: a screening from the portal or the API that doesn't say whether to monitor is enrolled for monitoring. Monitoring is included in the screening price. |
| **Re-screen frequency** | Daily | **Daily**, **Weekly**, **Monthly** (every 30 days) | Applies to each monitored customer from their next re-screening. See [B7 Ongoing monitoring](/help/b7). |

### Adverse media

| Setting | Default | What changes |
|---|---|---|
| **Screen for every category** | On | Off: tick the kinds of negative news that count. News about anything else is left out of the result. You must keep at least one. |

There are 15 categories, from **Financial crime**, **Fraud** and **Corruption or bribery** to **Cybercrime** and **Other adverse news**.

### Documents (IDP)

| Setting | Default | Options | What changes |
|---|---|---|---|
| **AI-generated document** | **Reject automatically** | **Reject automatically**, **Send to review** | For documents with generator metadata, content credentials or visual signs of AI generation. |
| **Other document fraud** | **Reject automatically** | **Reject automatically**, **Send to review** | For expired, altered or impossible documents and failed MRZ checks. |
| **Proof of address maximum age (days)** | 90 | 1 to 365 | A proof of address older than this fails the age check. It applies only when a request doesn't set its own limit: the **Documents (IDP)** form fills in 90 days, so clear that field to use this setting. API requests that leave the limit out use it. |
| **Accepted proof of address documents** | **Accept every recognised type** | Any of 23 types, such as Electricity bill, Water bill, Bank statement, Rental agreement and Property rates bill | A document of a type you don't accept can't pass and goes to review. You must keep at least one. |

A document is sent to review instead of rejected only when every critical reason is one you send to review. The report then says "Sent to review instead of rejected, under your organization's document rules." See [B5 Document checks](/help/b5).

![Documents (IDP) section with the fraud actions](/help/shots/a7-documents.png)

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| "Only your organization's Admin can change these settings." | You can read the rules but not change them. | Ask your Admin. |
| "You have unsaved changes." | You changed something that isn't saved yet. | Click **Save changes** or **Discard**. |
| "All changes saved." | The page matches the saved rules. | Nothing. |
| An error naming a field and its range | A value is outside the allowed range. Nothing was saved. | Correct the value and save again. |
| "No cleared hits yet." | No reviewer has approved an AML case since memory began. | Nothing. |
| **Not raised** with a count | How many times a cleared hit was left out of later screenings. | Click **Forget** if it should be raised again. |

## Common questions

### Do changes apply to checks already run?

No. Rules apply to checks, screenings and review cases from the moment you save. Past results keep the verdict they had. Monitored customers pick up a new frequency at their next re-screening.

### Do any of these settings cost credits?

No. Face match, duplicate face search, the fraud network, AI hit review and ongoing monitoring are part of the normal check or screening price.

### Should we raise the match threshold to cut false positives?

Turn on **Don't raise cleared hits again** first: it removes repeat hits without missing new ones. A higher threshold can miss spelling variants of Kenyan and Somali names. Record your reasons in your AML policy if you raise it.

### Can I undo a change?

Yes. Set the value back and save. Each save shows as "Changed screening rules" in **Settings** → **Audit & data**, with the values before and after.

### Does leaving the Sentinel network remove our data?

No. Your fingerprints stay with your own checks, so your own comparisons go on. Other organizations' checks stop being compared with yours straight away. Only keyed fingerprints were ever compared, never the numbers or names.

## Related chapters

- [A8 Review rules](/help/a8)
- [B2 KYC identity checks](/help/b2)
- [B5 Document checks](/help/b5)
- [B6 AML screening](/help/b6)
- [B7 Ongoing monitoring](/help/b7)
- [B10 Fraud signals explained](/help/b10)
- [B11 Deciding a review case](/help/b11)
- [B12 Customer risk and periodic reviews](/help/b12)
- [B13 Transaction monitoring](/help/b13)
