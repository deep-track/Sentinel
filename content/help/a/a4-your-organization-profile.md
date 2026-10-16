---
id: a4
title: Your organization profile
summary: Set your legal name, regulator and licence, compliance contact, goAML entity ID and logo, which Sentinel prints on reports and STRs.
roles: Admin
---

## What it's for

Your organization profile tells Sentinel who you are as a regulated institution. Sentinel copies it onto the documents your team produces:

- The header of every AML screening report, on screen and in the PDF: legal name, registration number, regulator and licence, and compliance contact. On screen, the report also shows your logo.
- The monthly report on the **Reports** page, with the same details and your logo.
- Suspicious transaction reports (STRs) for goAML: your goAML reporting entity ID and branch, your registered address and city, and the compliance contact, with their email and phone, as the reporting person. goAML is the Financial Reporting Centre's (FRC's) system for receiving these reports.
- Your invoices from DeepTrack: your legal name and registered address.

Fill it in once, after you sign up. When you signed up, Sentinel filled in your company name as the legal name, and you as the compliance contact. Check both.

## Who can use it

- Only an **Admin** can change the profile and the logo.
- Everyone else on your team, **Reviewer**, **Analyst**, **Developer** and **Viewer / Auditor**, can open the page and read it. They see the note "Only your organization's Admin can change these settings."

## Step by step

### Open the page

1. Click **Settings** in the sidebar.
2. Click the **Organization** tab. The page has two parts: **Logo** and **Organization details**.

![Settings, Organization tab for Demo Bank Ltd, with the Logo and Organization details cards](/help/shots/a4-organization.png "TODO")

### Fill in your organization details

1. In **Legal name**, type your name exactly as registered, for example "Demo Bank Limited".
2. In **Registration number**, type your BRS company number, for example PVT-AB1CD2E.
3. Choose your **Regulator**:
   - **Central Bank of Kenya** for banks and microfinance banks.
   - **Sacco Societies Regulatory Authority** for SACCOs.
   - **Capital Markets Authority**, **Insurance Regulatory Authority** or **Retirement Benefits Authority** where they license you.
   - **Business Registration Service** or **Financial Reporting Centre** if neither of the above applies.
   - **Other**, then type the name in **Regulator name**.
4. In **Licence number**, type the number on your licence from that regulator.
5. Fill in **Registered address** and **City**.
6. In **Compliance contact**, type the name of your MLRO (money laundering reporting officer) or chief risk officer. This person is named as the reporting person on your STRs.
7. Fill in **Compliance contact email** and **Compliance contact phone**. The email must be a valid address.
8. In **goAML reporting entity ID**, type the ID the FRC gave you when you registered on goAML. If the FRC gave you a branch code, type it in **goAML branch (optional)**.
9. Click **Save changes**. To undo your edits before saving, click **Discard**.

Each field holds up to 300 characters. Spaces at the start and end are removed, and an empty field is cleared.

![Organization details filled in for Demo Bank Ltd, with Central Bank of Kenya chosen as regulator](/help/shots/a4-details.png "TODO")

### Add your logo

1. Under **Logo**, click **Upload**.
2. Choose a PNG, JPEG or WebP image of up to 1 MB. A wide logo on a transparent background works best.
3. The logo saves straight away. You don't need to click **Save changes**.
4. To change it, click **Replace**. To take it off, click **Remove**.

![Logo card with an uploaded logo and the Replace and Remove buttons](/help/shots/a4-logo.png "TODO")

## What each result means

| What you see | What it means | What to do |
|---|---|---|
| "All changes saved." | The profile on screen is the one Sentinel uses. | Nothing. |
| "You have unsaved changes." | You edited a field but haven't saved. | Click **Save changes**, or **Discard**. |
| "Logo updated" | The new logo is saved. | Nothing. |
| "Use a PNG, JPEG or WebP image of at most 1 MB." | The file is the wrong type or too large. | Resize or convert it, then upload again. |
| "The compliance contact email is not valid." | The email address isn't in a valid form. | Correct it and save. |
| **No logo** | No logo is uploaded. Reports show your legal name only. | Upload one if you want it on reports. |

If the goAML entity ID or the compliance contact is missing, your team can't prepare an STR. They see "Add your goAML reporting entity ID in Settings → Organization first." or "Add your compliance contact (the reporting person) in Settings → Organization first." Fill in the field and they can try again.

## Common questions

### Where do I find our goAML reporting entity ID?

The FRC assigns it when your institution registers on goAML. Your MLRO usually has it. Sentinel needs it before anyone can prepare an STR. See [B14 Filing an STR or SAR](/help/b14).

### Do changes reach reports we already downloaded?

No. A PDF you downloaded keeps the details it had. Reports and STR files you open or download after saving use the new profile. An invoice keeps the name and address it was issued with.

### Is a change recorded?

Yes. Each save, and each logo change, appears in the audit log as "Changed the organization profile", with the values before and after. See [A10 The audit log](/help/a10).

### Does the profile change our organization's name in Sentinel?

No. The name in the sidebar is set when your account is created. The legal name is what Sentinel prints on reports and invoices.

### We have no compliance contact yet. Can we leave it empty?

Yes, but reports won't name one, and your team can't prepare STRs until you add one.

### Does this cost credits?

No. Editing the profile is free.

## Related chapters

- [A1 Signing up and your free trial](/help/a1)
- [A2 Choosing a plan and paying](/help/a2)
- [A5 Team members and roles](/help/a5)
- [A10 The audit log](/help/a10)
- [A11 Data retention and data requests](/help/a11)
- [B9 Reading a report and its PDF](/help/b9)
- [B14 Filing an STR or SAR](/help/b14)
