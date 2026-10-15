import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { recordLedgerEntry } from "./lib/credits";
import { requireClientRole } from "./lib/rbac";
import { recordAudit } from "./auditLog";
import { notify } from "./notifications";
import {
  cleanSignup,
  currencyForCountry,
  emailDomain,
  isWorkEmail,
  MAX_REQUESTS_PER_DAY,
  MAX_REQUESTS_PER_EMAIL_PER_DAY,
  TRIAL_CREDITS,
  TRIAL_DAYS,
  TRIAL_RPM_CAP,
} from "./lib/signups";

// Self-service sign-up.
//  1. /signup (public): name, work email, organization, country. The
//     request is stored and the portal sends an Auth0 invitation to the
//     email (app/signup/actions.ts), so the person sets a password there.
//  2. Signed in without a workspace, /access-pending offers the free trial
//     (startTrial): a trial client with the person as its Admin, trial
//     credits and a 14-day end date. One trial per person and per company
//     email domain, work emails only, verified emails only.
//  3. expireTrials (daily cron) ends trials; the workspace stays readable so
//     the Admin can pay. Paying any invoice upgrades the client to Starter
//     (billing.ts markInvoicePaid).
// DeepTrack's internal admins are emailed about every new trial.

const internalApi: any = internal;
const DAY_MS = 24 * 60 * 60 * 1000;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

// Public: the /signup form. Rate-limited per email and overall.
export const request = mutation({
  args: { name: v.string(), email: v.string(), company: v.string(), country: v.string() },
  handler: async (ctx, args) => {
    const clean = cleanSignup(args);
    if ("error" in clean) invalid(clean.error);
    const now = Date.now();
    const recent = await ctx.db.query("signupRequests").withIndex("by_email", (q) => q.eq("email", clean.email)).take(20);
    if (recent.filter((row) => row.createdAt > now - DAY_MS).length >= MAX_REQUESTS_PER_EMAIL_PER_DAY) {
      invalid("We've already sent an invitation to this email. Check your inbox, or try again tomorrow.");
    }
    const today = await ctx.db.query("signupRequests").withIndex("by_created_at", (q) => q.gt("createdAt", now - DAY_MS)).take(MAX_REQUESTS_PER_DAY + 1);
    if (today.length > MAX_REQUESTS_PER_DAY) invalid("Sign-ups are busy right now. Please try again later, or contact sales@deeptrack.io.");
    const domainTaken = await ctx.db.query("clients").withIndex("by_signup_domain", (q) => q.eq("signupDomain", emailDomain(clean.email))).first();
    const requestId = await ctx.db.insert("signupRequests", { ...clean, status: "pending", createdAt: now });
    return { requestId, existingTrial: domainTaken !== null };
  },
});

async function trialBlocker(ctx: { db: any }, identity: { subject: string; email?: string; emailVerified?: boolean }): Promise<string | null> {
  const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (!email) return "Your account has no email address.";
  if (identity.emailVerified !== true) return "Verify your email address first (check your inbox), then sign in again.";
  if (!isWorkEmail(email)) return "Free trials need a work email address. Sign in with your work email, or contact sales@deeptrack.io.";
  const owned = await ctx.db.query("clients").withIndex("by_signup_owner", (q: any) => q.eq("signupOwner", identity.subject)).first();
  if (owned) return "You've already started a trial. Ask its Admin to invite you, or contact sales@deeptrack.io.";
  const domain = await ctx.db.query("clients").withIndex("by_signup_domain", (q: any) => q.eq("signupDomain", emailDomain(email))).first();
  if (domain) return `Someone at ${emailDomain(email)} already started a trial. Ask them to invite you from Settings → Team.`;
  const memberships = await ctx.db.query("clientMembers").withIndex("by_user", (q: any) => q.eq("userId", identity.subject)).take(10);
  if (memberships.some((row: { isActive: boolean }) => row.isActive)) return "You already belong to a workspace.";
  return null;
}

// For /access-pending: can this person start a trial, and what did they
// enter on /signup?
export const myTrialStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const blocker = await trialBlocker(ctx, identity as any);
    const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
    const requests = email ? await ctx.db.query("signupRequests").withIndex("by_email", (q) => q.eq("email", email)).take(20) : [];
    const latest = requests.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return {
      canStart: blocker === null,
      reason: blocker,
      email,
      prefill: latest ? { name: latest.name, company: latest.company, country: latest.country } : null,
      trialDays: TRIAL_DAYS,
    };
  },
});

export const startTrial = mutation({
  args: { company: v.string(), country: v.string(), phone: v.optional(v.string()), acceptTerms: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
    if (!args.acceptTerms) invalid("Accept the terms of service to start the trial.");
    const blocker = await trialBlocker(ctx, identity as any);
    if (blocker) invalid(blocker);
    const email = String(identity.email).trim().toLowerCase();
    const company = args.company.trim().replace(/\s+/g, " ");
    if (company.length < 2 || company.length > 120) invalid("Enter your organization's name.");
    const country = args.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) invalid("Choose your country.");
    const phone = args.phone?.trim().slice(0, 30) || undefined;

    const now = Date.now();
    const currency = currencyForCountry(country);
    const clientId = await ctx.db.insert("clients", {
      name: company,
      plan: "trial",
      status: "active",
      creditLimit: TRIAL_CREDITS[currency],
      creditBalance: 0,
      rpmCap: TRIAL_RPM_CAP,
      creditThresholdPct: 80,
      billingCurrency: currency,
      trialEndsAt: now + TRIAL_DAYS * DAY_MS,
      signupSource: "self_service",
      signupOwner: identity.subject,
      signupDomain: emailDomain(email),
      createdAt: now,
    });
    await recordLedgerEntry(ctx, { clientId, type: "allocation", amount: TRIAL_CREDITS[currency], reason: `Free trial credits (${TRIAL_DAYS} days)` });
    await ctx.db.insert("clientMembers", { clientId, userId: identity.subject, role: "client_admin", isActive: true, createdAt: now });
    await ctx.db.insert("clientSettings", { clientId, profile: { legalName: company, ...(phone ? { complianceContactPhone: phone } : {}), complianceContactEmail: email, complianceContactName: typeof identity.name === "string" ? identity.name.slice(0, 100) : undefined }, updatedAt: now, updatedBy: identity.subject });
    const requests = await ctx.db.query("signupRequests").withIndex("by_email", (q) => q.eq("email", email)).take(20);
    for (const row of requests) if (row.status !== "completed") await ctx.db.patch(row._id, { status: "completed", completedAt: now });
    await recordAudit(ctx, {
      actorId: identity.subject,
      actorType: "client_user",
      action: "client.trial_started",
      targetType: "client",
      targetId: clientId,
      clientId,
      metadata: { company, country, currency, credits: TRIAL_CREDITS[currency], trialDays: TRIAL_DAYS, email },
    });
    await ctx.scheduler.runAfter(0, internalApi.signups.notifyDeepTrack, { company, email, country, phone: phone ?? null });
    return { clientId };
  },
});

// Emails DeepTrack's internal admins about a new trial (Resend).
export const notifyDeepTrack = internalAction({
  args: { company: v.string(), email: v.string(), country: v.string(), phone: v.union(v.string(), v.null()) },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.NOTIFICATIONS_FROM_EMAIL?.trim();
    const to = (process.env.SENTINEL_INTERNAL_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
    if (!apiKey || !from || to.length === 0) return;
    const text = `${args.company} (${args.country}) started a ${TRIAL_DAYS}-day Sentinel trial.\nAdmin: ${args.email}${args.phone ? `\nPhone: ${args.phone}` : ""}\n\nSee them in the Back Office → Clients.`;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject: `New Sentinel trial: ${args.company}`, text }),
      });
      if (!response.ok) console.error("[signups] notification rejected", response.status);
    } catch (error) {
      console.error("[signups] notification failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    }
  },
});

// Daily cron: trials past their end date stop running checks.
export const expireTrials = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const trials = await ctx.db.query("clients").withIndex("by_plan_and_status", (q) => q.eq("plan", "trial").eq("status", "active")).take(1000);
    let expired = 0;
    for (const client of trials) {
      if (client.trialEndsAt === undefined || client.trialEndsAt > now) continue;
      await ctx.db.patch(client._id, { status: "trial_expired" });
      await recordAudit(ctx, { actorId: "system", actorType: "system", action: "client.trial_expired", targetType: "client", targetId: client._id, clientId: client._id, metadata: { trialEndsAt: client.trialEndsAt } });
      await notify(ctx, {
        clientId: client._id,
        event: "low_credit",
        title: "Your Sentinel trial has ended",
        body: "New checks are paused. Top up on the Billing page to continue on the Starter plan; your results and settings are kept.",
        link: "/billing",
      });
      expired += 1;
    }
    return { expired };
  },
});


// The portal banner for a trial workspace: days left, or ended.
export const trialBanner = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.plan !== "trial") return null;
    const now = Date.now();
    return {
      expired: client.status === "trial_expired" || (client.trialEndsAt !== undefined && client.trialEndsAt <= now),
      daysLeft: client.trialEndsAt === undefined ? null : Math.max(0, Math.ceil((client.trialEndsAt - now) / DAY_MS)),
      balance: client.creditBalance ?? 0,
    };
  },
});
