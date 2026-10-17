---
id: a6
title: Security and single sign-on
summary: Connect single sign-on, require two-step sign-in, set an idle timeout, and limit Sentinel and the API to your own networks.
roles: Admin
---

## What it's for

Regulators such as CBK and SASRA expect you to control who can reach customer data, and from where. **Settings** → **Security** lets you:

- connect single sign-on (SSO), so your team signs in with their company Microsoft, Google or other work account
- require two-step verification (MFA: a second step, such as a code from a phone app, after the password)
- sign people out after a period of inactivity
- limit who can be invited, by email domain
- allow Sentinel, and optionally the API, only from your own networks (an IP allowlist)

These rules apply to everyone in your organization. DeepTrack's review team follows DeepTrack's own security policy instead.

## Who can use it

- Only an **Admin** can change these settings or set up single sign-on.
- Other roles can open **Settings** → **Security** and read the current settings. They see "Only your organization's Admin can change these settings." The **Single sign-on** section is shown to Admins only.
- Every change is recorded in the audit log with the old and new values.

## Step by step

Click **Settings** in the sidebar, then the **Security** tab.

### Set up single sign-on

Setting up SSO takes two stages: start it in Sentinel, then copy details between Sentinel and your identity provider. You need someone who can create an app in your provider, usually your IT team.

1. Under **Single sign-on**, choose your **Identity provider**: **Microsoft Entra ID (Azure AD)**, **Google Workspace**, **SAML 2.0 (Okta, ADFS, OneLogin, …)** or **OpenID Connect**.
2. In **Your email domains**, type your company domains, one per line, for example `demo-bank.example`. You can add up to 10. Public domains such as gmail.com can't be used, and a domain can belong to one organization only.
3. Click **Set up single sign-on**.
4. Follow the instructions under **1. In** your provider. Click the copy button next to **Redirect URI** (or, for SAML, **ACS (reply) URL** and **Entity ID (audience)**) and paste these into your provider.
5. Under **2. Paste its details**, fill in what your provider gives you:
   - Microsoft Entra ID: **Tenant domain**, **Client ID** and **Client secret**
   - Google Workspace: **Client ID** and **Client secret**
   - OpenID Connect: **Discovery URL**, **Client ID** and **Client secret**
   - SAML: **Sign-in URL**, **Sign-out URL (optional)** and **Signing certificate (PEM)**
6. Click **Connect**. To stop part-way, click **Cancel**.

![Single sign-on section after Set up single sign-on, showing the redirect URI and the details form](/help/shots/a6-sso-setup.png)

Sentinel doesn't store your client secret or certificate. They go straight to the sign-in service.

### Test and require single sign-on

1. Click **Test sign-in with your company account**. Sentinel signs you out and back in through your provider. Check that it works before the next step.
2. Turn on **Require single sign-on for** your domains and confirm. From now on, anyone at those domains who signed in with a password sees "Sign in with your company account" and must sign in again through your provider. Members at other domains are not affected.
3. Under **New people who sign in with SSO**, choose what happens to someone at your domains who signs in without an invitation:
   - **Nobody: people still need an invitation** (the default)
   - **Viewer / Auditor**, **Analyst**, **Reviewer** or **Developer**: they join with that role, as long as you have a free seat.

New people can't join as Admin this way. A member you deactivated stays deactivated even if they sign in through SSO.

![Single sign-on connected to Microsoft Entra ID for demo-bank.example](/help/shots/a6-sso-connected.png)

To switch providers, click **Remove single sign-on** and confirm, then set it up again. People who only sign in with SSO lose access until it is connected again or they set a password.

### Require two-step sign-in

1. Under **Sign-in**, turn on **Require two-step verification (MFA) for all members**.
2. Click **Save changes**.

A member who signed in without a second step sees "Two-step sign-in required". They click **Sign in with two-step verification** and complete the second step to continue.

### Sign people out after inactivity

1. Under **Sign-in**, choose **Sign out after inactivity**: **Off**, **15 minutes**, **30 minutes**, **1 hour**, **2 hours**, **4 hours** or **8 hours**. The default is **Off**.
2. Click **Save changes**.

Activity in any Sentinel tab counts. A minute before the time runs out, the member sees a warning. Moving the mouse or pressing a key keeps them signed in.

### Limit invitations to your email domains

1. Under **Allowed email domains**, type one domain per line, for example `demo-bank.example`. Subdomains are included. You can add up to 20.
2. Click **Save changes**.

Leave the box empty to allow any address. Existing members at other domains keep access, but **Settings** → **Team** marks them "Outside your allowed email domains". See [A5 Team members and roles](/help/a5).

### Allow Sentinel only from your networks

1. Under **IP allowlist**, type one IPv4 or IPv6 address or CIDR range per line, for example `196.201.214.0/24` for your head office. You can add up to 50.
2. Sentinel shows "You are connecting from" your current address. Click **Add my address** to add it. You can't save a list that leaves out your own address, so you can't lock yourself out.
3. To apply the same list to API requests, turn on **Apply to API requests too**. Add your servers' outbound addresses first.
4. Click **Save changes**.

![IP allowlist with the head office range and Apply to API requests too turned on](/help/shots/a6-ip-allowlist.png)

Leave the list empty to allow any network.

## What each result means

When a rule blocks someone, they see a Sentinel security page instead of the portal. Each page has a **Logout** button. If they belong to other organizations, it also offers "Or switch to another organization:".

| What they see | Why | What to do |
|---|---|---|
| "This network isn't allowed" | They are connecting from an address that isn't on your IP allowlist. The page shows their address. | Connect from the office network or VPN, or the Admin adds the address. |
| "Sign in with your company account" | Your organization requires SSO and they signed in another way. | Click **Sign in with your company account**. |
| "Two-step sign-in required" | Your organization requires MFA and they signed in without a second step. | Click **Sign in with two-step verification**. |
| A warning that they'll be signed out in a minute | The inactivity timeout is about to run out. | Move the mouse or press a key. |
| API error 403, "Requests from this IP address aren't allowed for your organization." | **Apply to API requests too** is on and the call came from an address not on the list. | Add your server's outbound address to the allowlist. |

## Common questions

### Do these rules apply to DeepTrack's review team?

No. DeepTrack's staff follow DeepTrack's own security policy, so your rules don't block support when you ask for help.

### What happens if someone belongs to two organizations with different rules?

The rules of the organization they have selected in the sidebar apply. If one organization blocks them, they can switch to another one from the security page.

### Does requiring SSO affect our auditors at another firm?

No. Only members whose email is at your SSO domains must use SSO. An external auditor at another domain keeps signing in as before.

### What if our office IP address changes?

Members on the new address are blocked from the portal, and API calls are refused if the API option is on. Before your provider changes the address, add the new one, save, then remove the old one.

### Can I see who changed a security setting?

Yes. Every save, and every SSO change, is recorded in the audit log with the before and after values. See [A10 The audit log](/help/a10).

### How do I sign out everyone at once?

Sentinel has no button for this today. Each member can click **Logout** at the top right. To stop one person straight away, deactivate them in **Settings** → **Team**.

## Related chapters

- [A1 Signing up and your free trial](/help/a1)
- [A4 Your organization profile](/help/a4)
- [A5 Team members and roles](/help/a5)
- [A9 Notifications](/help/a9)
- [A10 The audit log](/help/a10)
- [C1 Quick start](/help/c1)
