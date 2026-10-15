import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole, requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { recordLedgerEntry } from "./lib/credits";
import { loadClientSettings } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { notify } from "./notifications";
import { PLAN_LABELS, PLAN_PREPAY, PLANS, planCredits, type BillingCurrency, type Plan } from "./lib/pricing";
import {
  cleanEmail,
  invoiceNumber,
  invoiceTotals,
  MAX_VAT_RATE_PCT,
  PAYMENT_TERMS_DAYS,
  round2,
  TOP_UP_LIMITS,
  TOP_UP_PRESETS,
  topUpQuote,
  toSubunits,
  type InvoiceLine,
} from "./lib/invoices";
import { chargeAuthorization, initializeTransaction, paymentMatches, paymentReference, paystackSecret, verifyTransaction, type PaystackTransaction } from "./lib/paystack";

// Billing: invoices, Paystack payments and automatic top-ups.
//
//  - A client Admin tops up from the Billing page: an invoice is issued and
//    paid on Paystack's checkout (card or mobile money). Paystack's signed
//    webhook (http.ts /webhooks/paystack) or the return to the Billing page
//    verifies the transaction with Paystack and settles it once: the
//    invoice is marked paid and its credits are added to the ledger.
//  - DeepTrack issues invoices (plan prepayments, other charges) in the
//    Back Office. Clients pay them on Paystack, or by bank transfer / M-Pesa
//    paybill to the bank (the payment instructions on every invoice), and
//    DeepTrack marks those paid.
//  - Automatic top-up: with a card saved on a Paystack payment, the card is
//    charged when the balance falls to the client's threshold (at most every
//    12 hours, lib/autoTopUp.ts).
// The card's Paystack authorization code is never sent to the browser.

const internalApi: any = internal;
const READ_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"] as const;
const MAX_LISTED = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function appUrl() {
  return (process.env.SENTINEL_APP_URL?.trim() || "https://sentinel.deeptrack.io").replace(/\/+$/, "");
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function billingSettingsRow(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
}

async function clientBillingRow(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  return await ctx.db.query("clientBilling").withIndex("by_client", (q) => q.eq("clientId", clientId)).first();
}

function sellerOf(settings: Doc<"billingSettings"> | null) {
  const seller = settings?.seller ?? {};
  return {
    name: seller.name?.trim() || "DeepTrack",
    ...(seller.address ? { address: seller.address } : {}),
    ...(seller.kraPin ? { kraPin: seller.kraPin } : {}),
    ...(seller.email ? { email: seller.email } : {}),
    ...(seller.paymentInstructions ? { paymentInstructions: seller.paymentInstructions } : {}),
  };
}

// Issues an invoice with the next number (transactional, so numbers never repeat).
async function issue(
  ctx: MutationCtx,
  params: { clientId: Id<"clients">; kind: Doc<"invoices">["kind"]; lines: InvoiceLine[]; credits: number; createdBy: string; automatic?: boolean; dueDays?: number; notes?: string },
): Promise<Doc<"invoices">> {
  const client = await ctx.db.get(params.clientId);
  if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
  const [settings, profile, billing] = await Promise.all([billingSettingsRow(ctx), loadClientSettings(ctx, params.clientId), clientBillingRow(ctx, params.clientId)]);
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const sequence = settings?.invoiceYear === year ? settings.invoiceNext ?? 1 : 1;
  if (settings) await ctx.db.patch(settings._id, { invoiceYear: year, invoiceNext: sequence + 1 });
  else await ctx.db.insert("billingSettings", { key: "default", invoiceYear: year, invoiceNext: sequence + 1, updatedAt: now, updatedBy: params.createdBy });
  const vatRatePct = settings?.seller?.vatRatePct ?? 0;
  const totals = invoiceTotals(params.lines, vatRatePct);
  const invoiceId = await ctx.db.insert("invoices", {
    clientId: params.clientId,
    number: invoiceNumber(year, sequence),
    kind: params.kind,
    status: "issued",
    currency: client.billingCurrency ?? "USD",
    lines: params.lines,
    ...totals,
    vatRatePct,
    credits: params.credits,
    buyer: {
      name: profile.profile.legalName?.trim() || client.name,
      ...(profile.profile.address ? { address: profile.profile.address } : {}),
      ...(billing?.taxPin ? { kraPin: billing.taxPin } : {}),
      ...(billing?.billingEmail ? { email: billing.billingEmail } : {}),
    },
    seller: sellerOf(settings),
    issuedAt: now,
    dueAt: now + (params.dueDays ?? PAYMENT_TERMS_DAYS) * DAY_MS,
    createdBy: params.createdBy,
    ...(params.automatic ? { automatic: true } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
  });
  return (await ctx.db.get(invoiceId))!;
}

// Marks an invoice paid and adds its credits, once.
async function markInvoicePaid(
  ctx: MutationCtx,
  invoice: Doc<"invoices">,
  payment: { method: NonNullable<Doc<"invoices">["paymentMethod"]>; reference: string; by: string },
): Promise<boolean> {
  if (invoice.status !== "issued") return false;
  const now = Date.now();
  await ctx.db.patch(invoice._id, { status: "paid", paidAt: now, paymentMethod: payment.method, paymentReference: payment.reference.slice(0, 120), markedPaidBy: payment.by });
  if (invoice.credits > 0) {
    await recordLedgerEntry(ctx, { clientId: invoice.clientId, type: "allocation", amount: invoice.credits, reason: `Invoice ${invoice.number} paid (${payment.method.replace("_", " ")})` });
  }
  await recordAudit(ctx, {
    actorId: payment.by,
    actorType: payment.method === "paystack" ? "system" : "internal_admin",
    action: "billing.invoice_paid",
    targetType: "invoice",
    targetId: invoice._id,
    clientId: invoice.clientId,
    metadata: { number: invoice.number, total: invoice.total, currency: invoice.currency, credits: invoice.credits, method: payment.method, reference: payment.reference.slice(0, 120) },
  });
  return true;
}

function invoiceView(invoice: Doc<"invoices">) {
  return {
    _id: invoice._id,
    number: invoice.number,
    kind: invoice.kind,
    status: invoice.status,
    currency: invoice.currency,
    lines: invoice.lines,
    subtotal: invoice.subtotal,
    vatRatePct: invoice.vatRatePct,
    vat: invoice.vat,
    total: invoice.total,
    credits: invoice.credits,
    buyer: invoice.buyer,
    seller: invoice.seller,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt ?? null,
    paymentMethod: invoice.paymentMethod ?? null,
    paymentReference: invoice.paymentReference ?? null,
    automatic: invoice.automatic ?? false,
    voidedAt: invoice.voidedAt ?? null,
    notes: invoice.notes ?? null,
  };
}

// ── Client portal ───────────────────────────────────────────────────────────

export const overview = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, [...READ_ROLES]);
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
    const currency: BillingCurrency = client.billingCurrency ?? "USD";
    const [invoices, billing] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_client_and_issued_at", (q) => q.eq("clientId", args.clientId)).order("desc").take(MAX_LISTED),
      clientBillingRow(ctx, args.clientId),
    ]);
    return {
      currency,
      plan: client.plan,
      paystackEnabled: paystackSecret() !== null,
      canPay: actor.role === "client_admin" || actor.role === "internal_admin",
      limits: TOP_UP_LIMITS[currency],
      presets: TOP_UP_PRESETS[currency],
      invoices: invoices.map(invoiceView),
      options: {
        billingEmail: billing?.billingEmail ?? null,
        taxPin: billing?.taxPin ?? null,
        card: billing?.card ? { last4: billing.card.last4 ?? null, brand: billing.card.brand ?? null, expMonth: billing.card.expMonth ?? null, expYear: billing.card.expYear ?? null, savedAt: billing.card.savedAt } : null,
        autoTopUp: billing?.autoTopUp ?? null,
        lastAutoTopUpAt: billing?.lastAutoTopUpAt ?? null,
      },
    };
  },
});

// One invoice, for the printable page: the client's team or DeepTrack.
export const invoice = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, args) => {
    const invoiceId = ctx.db.normalizeId("invoices", args.invoiceId);
    const row = invoiceId ? await ctx.db.get(invoiceId) : null;
    if (!row) return null;
    await requireClientRole(ctx, row.clientId, [...READ_ROLES]);
    return invoiceView(row);
  },
});

export const saveOptions = mutation({
  args: {
    clientId: v.id("clients"),
    billingEmail: v.optional(v.string()),
    taxPin: v.optional(v.string()),
    autoTopUp: v.optional(v.object({ enabled: v.boolean(), amount: v.number(), thresholdCredits: v.number() })),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
    const existing = await clientBillingRow(ctx, args.clientId);
    const billingEmail = args.billingEmail?.trim() ? cleanEmail(args.billingEmail) : null;
    if (args.billingEmail?.trim() && !billingEmail) invalid("Enter a valid billing email.");
    const taxPin = args.taxPin?.trim().toUpperCase() || null;
    if (taxPin && !/^[A-Z0-9]{6,20}$/.test(taxPin)) invalid("Enter the KRA PIN as letters and digits, e.g. P051234567X.");
    if (args.autoTopUp?.enabled) {
      if (!existing?.card) invalid("Save a card with a Paystack payment first.");
      const limits = TOP_UP_LIMITS[client.billingCurrency ?? "USD"];
      if (!(args.autoTopUp.amount >= limits.min && args.autoTopUp.amount <= limits.max)) invalid(`The top-up amount must be ${limits.min.toLocaleString("en-US")}–${limits.max.toLocaleString("en-US")}.`);
      if (!Number.isInteger(args.autoTopUp.thresholdCredits) || args.autoTopUp.thresholdCredits < 0 || args.autoTopUp.thresholdCredits > 10_000_000) invalid("Enter the balance (in credits) that triggers a top-up.");
    }
    const now = Date.now();
    const fields = {
      ...(billingEmail ? { billingEmail } : { billingEmail: undefined }),
      ...(taxPin ? { taxPin } : { taxPin: undefined }),
      ...(args.autoTopUp ? { autoTopUp: args.autoTopUp } : {}),
      updatedAt: now,
      updatedBy: actor.userId,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("clientBilling", { clientId: args.clientId, ...fields });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "billing.options_updated",
      targetType: "client",
      targetId: args.clientId,
      clientId: args.clientId,
      metadata: { autoTopUp: args.autoTopUp ?? null, billingEmailSet: Boolean(billingEmail), taxPinSet: Boolean(taxPin) },
    });
    return null;
  },
});

export const removeCard = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const existing = await clientBillingRow(ctx, args.clientId);
    if (!existing?.card) return null;
    await ctx.db.patch(existing._id, {
      card: undefined,
      ...(existing.autoTopUp ? { autoTopUp: { ...existing.autoTopUp, enabled: false } } : {}),
      updatedAt: Date.now(),
      updatedBy: actor.userId,
    });
    await recordAudit(ctx, { actorId: actor.userId, actorType: actorTypeForClientRole(actor.role), action: "billing.card_removed", targetType: "client", targetId: args.clientId, clientId: args.clientId, metadata: {} });
    return null;
  },
});

// Creates (for a top-up) or loads the invoice, and its Paystack payment.
export const _startPayment = internalMutation({
  args: {
    clientId: v.id("clients"),
    amount: v.optional(v.number()),
    invoiceId: v.optional(v.id("invoices")),
    saveCard: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
    let invoice: Doc<"invoices"> | null;
    if (args.invoiceId) {
      invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.clientId !== args.clientId) throw new ConvexError({ code: "not_found", message: "Invoice not found." });
      if (invoice.status !== "issued") invalid(invoice.status === "paid" ? "This invoice is already paid." : "This invoice was cancelled.");
    } else {
      const quote = topUpQuote(args.amount ?? NaN, client.billingCurrency ?? "USD", client.plan as Plan);
      if ("error" in quote) invalid(quote.error);
      invoice = await issue(ctx, { clientId: args.clientId, kind: "top_up", lines: [quote.line], credits: quote.credits, createdBy: actor.userId });
    }
    const identity = await ctx.auth.getUserIdentity();
    const billing = await clientBillingRow(ctx, args.clientId);
    const email = cleanEmail(billing?.billingEmail) ?? cleanEmail(typeof identity?.email === "string" ? identity.email : null);
    if (!email) invalid("Add a billing email first.");
    const reference = paymentReference(randomId());
    await ctx.db.insert("payments", {
      clientId: args.clientId,
      invoiceId: invoice._id,
      reference,
      status: "initialized",
      amount: toSubunits(invoice.total),
      currency: invoice.currency,
      email,
      saveCard: args.saveCard,
      automatic: false,
      initiatedBy: actor.userId,
      createdAt: Date.now(),
    });
    return { reference, amount: toSubunits(invoice.total), currency: invoice.currency, email, invoiceId: invoice._id, invoiceNumber: invoice.number };
  },
});

async function checkout(ctx: { runMutation: any }, args: { clientId: Id<"clients">; amount?: number; invoiceId?: Id<"invoices">; saveCard: boolean }) {
  const secret = paystackSecret();
  if (!secret) throw new ConvexError({ code: "not_configured", message: "Online payment isn't set up yet. Pay by bank transfer or M-Pesa using the details on the invoice." });
  const started = await ctx.runMutation(internalApi.billing._startPayment, args);
  const session = await initializeTransaction(secret, {
    email: started.email,
    amount: started.amount,
    currency: started.currency,
    reference: started.reference,
    callbackUrl: `${appUrl()}/billing?payment=${started.reference}`,
    metadata: { invoice: started.invoiceNumber, client_id: args.clientId, sentinel: true },
  });
  return { url: session.authorization_url, reference: started.reference };
}

export const startTopUp = action({
  args: { clientId: v.id("clients"), amount: v.number(), saveCard: v.boolean() },
  handler: async (ctx, args): Promise<{ url: string; reference: string }> => await checkout(ctx, args),
});

export const payInvoice = action({
  args: { invoiceId: v.id("invoices"), saveCard: v.boolean() },
  handler: async (ctx, args): Promise<{ url: string; reference: string }> => {
    const clientId: Id<"clients"> | null = await ctx.runQuery(internalApi.billing._invoiceClient, { invoiceId: args.invoiceId });
    if (!clientId) throw new ConvexError({ code: "not_found", message: "Invoice not found." });
    return await checkout(ctx, { clientId, invoiceId: args.invoiceId, saveCard: args.saveCard });
  },
});

export const _invoiceClient = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => (await ctx.db.get(args.invoiceId))?.clientId ?? null,
});

export const _payment = internalQuery({
  args: { reference: v.string(), checkAccess: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const payment = await ctx.db.query("payments").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    if (!payment) return null;
    if (args.checkAccess) await requireClientRole(ctx, payment.clientId, [...READ_ROLES]);
    return payment;
  },
});

// Settles a payment from Paystack's verified transaction. Idempotent.
export const _settle = internalMutation({
  args: { reference: v.string(), transaction: v.any() },
  handler: async (ctx, args): Promise<{ status: "paid" | "already" | "failed" | "pending" }> => {
    const payment = await ctx.db.query("payments").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    if (!payment) return { status: "failed" };
    if (payment.status === "success") return { status: "already" };
    const transaction = args.transaction as PaystackTransaction;
    const now = Date.now();
    if (!paymentMatches(transaction, { reference: payment.reference, amount: payment.amount, currency: payment.currency })) {
      if (["success", "failed", "abandoned", "reversed"].includes(transaction.status) || transaction.reference !== payment.reference) {
        const reason =
          transaction.status === "success" ? "The amount or currency paid doesn't match the invoice." : (transaction.gateway_response ?? transaction.status ?? "failed").slice(0, 200);
        await ctx.db.patch(payment._id, { status: "failed", failureReason: reason, settledAt: now });
        if (payment.automatic) {
          await notify(ctx, { clientId: payment.clientId, event: "low_credit", title: "Automatic top-up failed", body: `The saved card couldn't be charged: ${reason}. Top up on the Billing page.`, link: "/billing" });
        }
        return { status: "failed" };
      }
      return { status: "pending" };
    }
    await ctx.db.patch(payment._id, { status: "success", channel: transaction.channel?.slice(0, 40), settledAt: now });
    const invoice = await ctx.db.get(payment.invoiceId);
    if (invoice) await markInvoicePaid(ctx, invoice, { method: "paystack", reference: payment.reference, by: "paystack" });
    // Save the card for automatic top-ups when asked to and Paystack allows it.
    const authorization = transaction.authorization;
    if (payment.saveCard && authorization?.reusable && authorization.authorization_code && (authorization.channel ?? transaction.channel) === "card") {
      const billing = await clientBillingRow(ctx, payment.clientId);
      const card = {
        authorizationCode: authorization.authorization_code,
        email: payment.email,
        ...(authorization.last4 ? { last4: authorization.last4 } : {}),
        ...(authorization.brand ? { brand: authorization.brand } : {}),
        ...(authorization.exp_month ? { expMonth: authorization.exp_month } : {}),
        ...(authorization.exp_year ? { expYear: authorization.exp_year } : {}),
        savedAt: now,
      };
      if (billing) await ctx.db.patch(billing._id, { card, updatedAt: now, updatedBy: payment.initiatedBy });
      else await ctx.db.insert("clientBilling", { clientId: payment.clientId, card, updatedAt: now, updatedBy: payment.initiatedBy });
    }
    return { status: "paid" };
  },
});

export const verifyAndSettle = internalAction({
  args: { reference: v.string() },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const secret = paystackSecret();
    if (!secret) return { status: "not_configured" };
    const transaction = await verifyTransaction(secret, args.reference);
    return await ctx.runMutation(internalApi.billing._settle, { reference: args.reference, transaction });
  },
});

// The Billing page calls this on return from Paystack's checkout, in case
// the webhook hasn't arrived yet.
export const confirmPayment = action({
  args: { reference: v.string() },
  handler: async (ctx, args): Promise<{ status: string; invoiceNumber: string | null }> => {
    const payment = await ctx.runQuery(internalApi.billing._payment, { reference: args.reference, checkAccess: true });
    if (!payment) return { status: "not_found", invoiceNumber: null };
    const result: { status: string } = payment.status === "success" ? { status: "already" } : await ctx.runAction(internalApi.billing.verifyAndSettle, { reference: args.reference });
    const invoiceNumber: string | null = await ctx.runQuery(internalApi.billing._invoiceNumber, { invoiceId: payment.invoiceId });
    return { status: result.status, invoiceNumber };
  },
});

export const _invoiceNumber = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => (await ctx.db.get(args.invoiceId))?.number ?? null,
});

// ── Automatic top-up ────────────────────────────────────────────────────────

export const _startAutoTopUp = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const [client, billing] = await Promise.all([ctx.db.get(args.clientId), clientBillingRow(ctx, args.clientId)]);
    if (!client || client.status !== "active" || !billing?.card || !billing.autoTopUp?.enabled) return null;
    const quote = topUpQuote(billing.autoTopUp.amount, client.billingCurrency ?? "USD", client.plan as Plan);
    if ("error" in quote) return null;
    const invoice = await issue(ctx, { clientId: args.clientId, kind: "top_up", lines: [quote.line], credits: quote.credits, createdBy: "system", automatic: true });
    const reference = paymentReference(randomId());
    await ctx.db.insert("payments", {
      clientId: args.clientId,
      invoiceId: invoice._id,
      reference,
      status: "initialized",
      amount: toSubunits(invoice.total),
      currency: invoice.currency,
      email: billing.card.email,
      saveCard: false,
      automatic: true,
      initiatedBy: "system",
      createdAt: Date.now(),
    });
    return { reference, amount: toSubunits(invoice.total), currency: invoice.currency, email: billing.card.email, authorizationCode: billing.card.authorizationCode, invoiceNumber: invoice.number };
  },
});

export const autoTopUp = internalAction({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const secret = paystackSecret();
    if (!secret) return;
    const started = await ctx.runMutation(internalApi.billing._startAutoTopUp, args);
    if (!started) return;
    let transaction: PaystackTransaction;
    try {
      transaction = await chargeAuthorization(secret, {
        email: started.email,
        amount: started.amount,
        currency: started.currency,
        reference: started.reference,
        authorizationCode: started.authorizationCode,
        metadata: { invoice: started.invoiceNumber, client_id: args.clientId, automatic: true },
      });
    } catch (error) {
      transaction = { status: "failed", reference: started.reference, amount: 0, currency: started.currency, gateway_response: error instanceof Error ? error.message.slice(0, 200) : "charge failed" };
    }
    await ctx.runMutation(internalApi.billing._settle, { reference: started.reference, transaction });
  },
});

// ── Back Office ─────────────────────────────────────────────────────────────

export const listForBackOffice = query({
  args: { clientId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const clientId = args.clientId ? ctx.db.normalizeId("clients", args.clientId) : null;
    const rows = clientId
      ? await ctx.db.query("invoices").withIndex("by_client_and_issued_at", (q) => q.eq("clientId", clientId)).order("desc").take(MAX_LISTED)
      : await ctx.db.query("invoices").withIndex("by_status_and_issued_at", (q) => q.eq("status", "issued")).order("desc").take(MAX_LISTED);
    const settings = await billingSettingsRow(ctx);
    const names = new Map<string, string>();
    for (const row of rows) {
      if (!names.has(row.clientId)) names.set(row.clientId, (await ctx.db.get(row.clientId))?.name ?? "Client");
    }
    return {
      invoices: rows.map((row) => ({ ...invoiceView(row), clientId: row.clientId, clientName: names.get(row.clientId) ?? "Client", overdue: row.status === "issued" && row.dueAt < Date.now() })),
      seller: settings?.seller ?? null,
      plans: PLANS.filter((plan) => plan !== "trial").map((plan) => ({ plan, label: PLAN_LABELS[plan], USD: PLAN_PREPAY.USD[plan], KES: PLAN_PREPAY.KES[plan] })),
      paystackEnabled: paystackSecret() !== null,
    };
  },
});

export const issueInvoice = mutation({
  args: {
    clientId: v.id("clients"),
    kind: v.union(v.literal("plan"), v.literal("other")),
    plan: v.optional(v.union(v.literal("starter"), v.literal("growth"), v.literal("business"), v.literal("enterprise"))),
    description: v.optional(v.string()),
    amount: v.optional(v.number()),
    credits: v.optional(v.number()),
    dueDays: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
    const currency: BillingCurrency = client.billingCurrency ?? "USD";
    let lines: InvoiceLine[];
    let credits: number;
    if (args.kind === "plan") {
      if (!args.plan) invalid("Choose the plan.");
      const price = PLAN_PREPAY[currency][args.plan];
      credits = planCredits(args.plan, currency);
      lines = [{ description: `Sentinel ${PLAN_LABELS[args.plan]} plan, annual prepayment (${credits.toLocaleString("en-US")} credits)`, quantity: 1, unitPrice: price, amount: price }];
    } else {
      const description = args.description?.trim();
      if (!description || description.length > 200) invalid("Describe the charge in up to 200 characters.");
      if (!(typeof args.amount === "number" && args.amount > 0 && args.amount <= 100_000_000)) invalid("Enter the amount.");
      credits = Math.max(0, Math.floor(args.credits ?? 0));
      const amount = round2(args.amount);
      lines = [{ description, quantity: 1, unitPrice: amount, amount }];
    }
    const dueDays = Math.min(Math.max(Math.floor(args.dueDays ?? PAYMENT_TERMS_DAYS), 0), 90);
    const invoice = await issue(ctx, { clientId: args.clientId, kind: args.kind, lines, credits, createdBy: actorId, dueDays, ...(args.notes?.trim() ? { notes: args.notes.trim().slice(0, 1000) } : {}) });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "billing.invoice_issued", targetType: "invoice", targetId: invoice._id, clientId: args.clientId, metadata: { number: invoice.number, total: invoice.total, currency, credits } });
    return { invoiceId: invoice._id, number: invoice.number };
  },
});

export const markPaid = mutation({
  args: { invoiceId: v.id("invoices"), method: v.union(v.literal("bank_transfer"), v.literal("mpesa"), v.literal("other")), reference: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new ConvexError({ code: "not_found", message: "Invoice not found." });
    const reference = args.reference.trim();
    if (reference.length < 3) invalid("Enter the bank or M-Pesa transaction reference.");
    if (!(await markInvoicePaid(ctx, invoice, { method: args.method, reference, by: actorId }))) invalid("Only an unpaid invoice can be marked paid.");
    return null;
  },
});

export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices"), reason: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new ConvexError({ code: "not_found", message: "Invoice not found." });
    if (invoice.status !== "issued") invalid("Only an unpaid invoice can be cancelled.");
    const reason = args.reason.trim();
    if (reason.length < 3) invalid("Say why the invoice is cancelled.");
    await ctx.db.patch(invoice._id, { status: "void", voidedAt: Date.now(), voidedBy: actorId, notes: [invoice.notes, `Cancelled: ${reason.slice(0, 300)}`].filter(Boolean).join("\n") });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "billing.invoice_voided", targetType: "invoice", targetId: invoice._id, clientId: invoice.clientId, metadata: { number: invoice.number, reason } });
    return null;
  },
});

export const saveSeller = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    kraPin: v.optional(v.string()),
    email: v.optional(v.string()),
    vatRatePct: v.number(),
    paymentInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const name = args.name.trim();
    if (!name || name.length > 120) invalid("Enter the company name.");
    if (!(args.vatRatePct >= 0 && args.vatRatePct <= MAX_VAT_RATE_PCT)) invalid(`VAT must be 0–${MAX_VAT_RATE_PCT}%.`);
    const text = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined;
    const seller = {
      name,
      address: text(args.address, 300),
      kraPin: text(args.kraPin?.toUpperCase(), 20),
      email: args.email?.trim() ? cleanEmail(args.email) ?? invalid("Enter a valid email.") : undefined,
      vatRatePct: args.vatRatePct,
      paymentInstructions: text(args.paymentInstructions, 1500),
    };
    const now = Date.now();
    const existing = await billingSettingsRow(ctx);
    if (existing) await ctx.db.patch(existing._id, { seller, updatedAt: now, updatedBy: actorId });
    else await ctx.db.insert("billingSettings", { key: "default", seller, updatedAt: now, updatedBy: actorId });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "billing.seller_updated", targetType: "billingSettings", targetId: "default", metadata: { vatRatePct: args.vatRatePct } });
    return null;
  },
});
