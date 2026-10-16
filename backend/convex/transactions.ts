import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClientRole } from "./lib/rbac";
import { REVIEW_WORK_ROLES, loadClientSettings } from "./lib/clientSettings";
import { recordAudit, actorTypeForClientRole } from "./auditLog";
import { notify } from "./notifications";
import { ratingConfig } from "./riskRatings";
import { normalizeName } from "./lib/amlMatching";
import { screenSubjects } from "./aml";
import {
  RULE_LABELS,
  configFromThresholds,
  cleanTransaction,
  evaluateTransactions,
  forRisk,
  toUsd,
  type Alert,
  type CleanTransaction,
  type MonitoringConfig,
  type RawTransaction,
  type Txn,
} from "./lib/transactionRules";

// Transaction monitoring (lib/transactionRules.ts): clients send their
// customers' transactions (API or CSV); each customer's history is checked
// against the rules, and counterparties are screened against sanctions and
// watch lists. Alerts go to the client's team to close or escalate (STR).

const internalApi: any = internal;

export const MAX_BATCH = 500;
// History per customer the rules look at.
const HISTORY_DAYS = 200;
const MAX_HISTORY = 3000;
// Counterparties screened per batch, and how long a screening is reused.
const MAX_SCREENINGS_PER_BATCH = 20;
const SCREENING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UPLOAD_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer"] as const;
const STR_ROLES = ["client_admin", "reviewer", "internal_admin"];

const COMPANY_WORDS = /\b(LTD|LIMITED|PLC|CO|COMPANY|ENTERPRISES?|SACCO|BANK|GROUP|HOLDINGS|INVESTMENTS?|TRADING|SERVICES|LLC|INC|CORP|FOUNDATION|TRUST)\b/;

export function counterpartyKey(name: string | null): string | null {
  const key = name ? normalizeName(name) : "";
  return key.length >= 3 ? key : null;
}

async function usdToKes(ctx: Pick<QueryCtx, "db">): Promise<number | null> {
  return (await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first())?.usdToKes ?? null;
}

type IngestResult = { accepted: number; duplicates: number; rejected: Array<{ index: number; externalId: string | null; error: string }> };

// Stores a batch, then checks every customer it touched. Shared by the API
// and the portal upload.
export async function ingestTransactions(ctx: MutationCtx, clientId: Id<"clients">, raw: RawTransaction[], source: "api" | "upload"): Promise<IngestResult> {
  if (raw.length > MAX_BATCH) throw new ConvexError({ code: "invalid_argument", message: `At most ${MAX_BATCH} transactions per batch.` });
  const rate = await usdToKes(ctx);
  const now = Date.now();
  const result: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };
  const touched = new Map<string, Id<"transactions">[]>();
  const counterparties = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const clean = cleanTransaction(item, now);
    if ("error" in clean) {
      result.rejected.push({ index, externalId: typeof item.externalId === "string" ? item.externalId.slice(0, 100) : null, error: clean.error });
      continue;
    }
    const amountUsd = toUsd(clean.amount, clean.currency, rate);
    if (amountUsd === null) {
      result.rejected.push({ index, externalId: clean.externalId, error: "No USD to KES rate is set, so KES amounts can't be checked." });
      continue;
    }
    const existing = await ctx.db.query("transactions").withIndex("by_client_and_external", (q) => q.eq("clientId", clientId).eq("externalId", clean.externalId)).first();
    if (existing) {
      result.duplicates += 1;
      continue;
    }
    const key = counterpartyKey(clean.counterpartyName);
    const id = await ctx.db.insert("transactions", {
      clientId,
      ...withoutNulls(clean),
      amountUsd,
      ...(key ? { counterpartyKey: key } : {}),
      source,
      createdAt: now,
    });
    touched.set(clean.customerRef, [...(touched.get(clean.customerRef) ?? []), id]);
    if (key && clean.counterpartyName) counterparties.add(clean.counterpartyName);
    result.accepted += 1;
  }
  for (const [customerRef, ids] of touched) {
    await ctx.scheduler.runAfter(0, internalApi.transactions.evaluateCustomer, { clientId, customerRef, newIds: ids });
  }
  if (counterparties.size) {
    await ctx.scheduler.runAfter(0, internalApi.transactions.screenCounterparties, { clientId, names: [...counterparties].slice(0, 200) });
  }
  return result;
}

function withoutNulls(clean: CleanTransaction) {
  return Object.fromEntries(Object.entries(clean).filter(([, value]) => value !== null)) as Omit<CleanTransaction, "counterpartyName" | "counterpartyCountry" | "counterpartyAccount" | "narration"> & {
    counterpartyName?: string;
    counterpartyCountry?: string;
    counterpartyAccount?: string;
    narration?: string;
  };
}

const rawTransaction = v.object({
  externalId: v.optional(v.any()),
  customerRef: v.optional(v.any()),
  occurredAt: v.optional(v.any()),
  amount: v.optional(v.any()),
  currency: v.optional(v.any()),
  direction: v.optional(v.any()),
  channel: v.optional(v.any()),
  counterpartyName: v.optional(v.any()),
  counterpartyCountry: v.optional(v.any()),
  counterpartyAccount: v.optional(v.any()),
  narration: v.optional(v.any()),
});

// POST /v1/transactions. Test keys validate without storing anything.
export const _ingestFromApi = internalMutation({
  args: { clientId: v.id("clients"), apiKeyId: v.string(), environment: v.union(v.literal("live"), v.literal("test")), transactions: v.array(rawTransaction) },
  handler: async (ctx, args) => {
    if (args.environment === "test") {
      const now = Date.now();
      const rejected = args.transactions.flatMap((item, index) => {
        const clean = cleanTransaction(item, now);
        return "error" in clean ? [{ index, externalId: typeof item.externalId === "string" ? item.externalId : null, error: clean.error }] : [];
      });
      return { accepted: args.transactions.length - rejected.length, duplicates: 0, rejected, sandbox: true };
    }
    const result = await ingestTransactions(ctx, args.clientId, args.transactions, "api");
    await recordAudit(ctx, { actorId: args.apiKeyId, actorType: "client_api_key", action: "transactions.ingested", targetType: "client", targetId: args.clientId, clientId: args.clientId, metadata: { accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected.length } });
    return result;
  },
});

// The portal's CSV upload (parsed in the browser into rows).
export const upload = mutation({
  args: { clientId: v.id("clients"), transactions: v.array(rawTransaction) },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, [...UPLOAD_ROLES]);
    const result = await ingestTransactions(ctx, args.clientId, args.transactions, "upload");
    await recordAudit(ctx, { actorId: actor.userId, actorType: actorTypeForClientRole(actor.role), action: "transactions.uploaded", targetType: "client", targetId: args.clientId, clientId: args.clientId, metadata: { accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected.length } });
    return result;
  },
});

function toTxn(row: Doc<"transactions">): Txn {
  return {
    id: row._id,
    occurredAt: row.occurredAt,
    amount: row.amount,
    currency: row.currency,
    amountUsd: row.amountUsd,
    direction: row.direction,
    channel: row.channel,
    counterpartyName: row.counterpartyName ?? null,
    counterpartyCountry: row.counterpartyCountry ?? null,
  };
}

// The customer's risk rating, when customerRef is a Sentinel check reference.
async function customerRisk(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">, customerRef: string): Promise<string | null> {
  const verification = await ctx.db.query("verifications").withIndex("by_reference", (q) => q.eq("reference", customerRef)).first();
  if (!verification || verification.clientId !== clientId) return null;
  return ((verification.result as { riskRating?: { level?: string } } | undefined)?.riskRating?.level as string | undefined) ?? null;
}

async function monitoringConfig(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">): Promise<MonitoringConfig> {
  const [{ config, homeCountry }, settings] = await Promise.all([ratingConfig(ctx, clientId), loadClientSettings(ctx, clientId)]);
  return { ...configFromThresholds(settings.screening.transactionMonitoring), callForAction: config.callForAction, increasedMonitoring: config.increasedMonitoring, homeCountry };
}

async function raiseAlerts(ctx: MutationCtx, clientId: Id<"clients">, customerRef: string, alerts: Alert[]): Promise<number> {
  let raised = 0;
  for (const alert of alerts) {
    const existing = await ctx.db.query("transactionAlerts").withIndex("by_client_customer_key", (q) => q.eq("clientId", clientId).eq("customerRef", customerRef).eq("key", alert.key)).first();
    if (existing) continue;
    await ctx.db.insert("transactionAlerts", {
      clientId,
      customerRef,
      rule: alert.rule,
      severity: alert.severity,
      status: "open",
      summary: alert.summary,
      transactionIds: alert.transactionIds.slice(0, 100) as Id<"transactions">[],
      key: alert.key,
      createdAt: Date.now(),
    });
    raised += 1;
  }
  if (raised) {
    await notify(ctx, {
      clientId,
      event: "transaction_alert",
      title: `${raised} transaction alert${raised === 1 ? "" : "s"} for ${customerRef}`,
      body: alerts.slice(0, 3).map((alert) => `${RULE_LABELS[alert.rule]}: ${alert.summary}`).join(" "),
      link: "/transactions",
    });
  }
  return raised;
}

export const evaluateCustomer = internalMutation({
  args: { clientId: v.id("clients"), customerRef: v.string(), newIds: v.array(v.id("transactions")) },
  handler: async (ctx, args) => {
    const since = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_client_customer_time", (q) => q.eq("clientId", args.clientId).eq("customerRef", args.customerRef).gte("occurredAt", since))
      .take(MAX_HISTORY);
    // The last transaction before the window, so a dormancy longer than the
    // window is still seen.
    const before = await ctx.db
      .query("transactions")
      .withIndex("by_client_customer_time", (q) => q.eq("clientId", args.clientId).eq("customerRef", args.customerRef).lt("occurredAt", since))
      .order("desc")
      .first();
    if (before) rows.unshift(before);
    const config = forRisk(await monitoringConfig(ctx, args.clientId), await customerRisk(ctx, args.clientId, args.customerRef));
    const alerts = evaluateTransactions(rows.map(toTxn), new Set<string>(args.newIds), config);
    return await raiseAlerts(ctx, args.clientId, args.customerRef, alerts);
  },
});

// Counterparties against sanctions, PEP and Kenyan risk lists (no adverse
// media search: too costly per counterparty). A screening is reused for 30
// days.
export const screenCounterparties = internalAction({
  args: { clientId: v.id("clients"), names: v.array(v.string()) },
  handler: async (ctx, args) => {
    const due: string[] = await ctx.runQuery(internalApi.transactions._unscreened, { clientId: args.clientId, names: args.names });
    const batch = due.slice(0, MAX_SCREENINGS_PER_BATCH);
    if (!batch.length) return;
    const subjects = batch.map((name) => ({ subjectName: name, entityType: COMPANY_WORDS.test(normalizeName(name)) ? ("entity" as const) : ("individual" as const) }));
    const outcomes = await screenSubjects(ctx, subjects, undefined, { adverseMedia: false });
    for (const [index, name] of batch.entries()) {
      await ctx.runMutation(internalApi.transactions._recordScreening, { clientId: args.clientId, name, verdict: outcomes[index].verdict, reason: outcomes[index].reason.slice(0, 500), complete: outcomes[index].complete });
    }
    if (due.length > batch.length) {
      await ctx.scheduler.runAfter(60_000, internalApi.transactions.screenCounterparties, { clientId: args.clientId, names: due.slice(batch.length) });
    }
  },
});

export const _unscreened = internalQuery({
  args: { clientId: v.id("clients"), names: v.array(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const due: string[] = [];
    const seen = new Set<string>();
    for (const name of args.names) {
      const key = counterpartyKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = await ctx.db.query("counterpartyScreenings").withIndex("by_client_and_key", (q) => q.eq("clientId", args.clientId).eq("key", key)).first();
      if (!row || now - row.screenedAt > SCREENING_TTL_MS) due.push(name);
    }
    return due;
  },
});

export const _recordScreening = internalMutation({
  args: { clientId: v.id("clients"), name: v.string(), verdict: v.union(v.literal("pass"), v.literal("review"), v.literal("reject")), reason: v.string(), complete: v.boolean() },
  handler: async (ctx, args) => {
    const key = counterpartyKey(args.name);
    if (!key) return;
    const now = Date.now();
    const existing = await ctx.db.query("counterpartyScreenings").withIndex("by_client_and_key", (q) => q.eq("clientId", args.clientId).eq("key", key)).first();
    if (existing) await ctx.db.patch(existing._id, { verdict: args.verdict, reason: args.reason, screenedAt: now });
    else await ctx.db.insert("counterpartyScreenings", { clientId: args.clientId, key, name: args.name.slice(0, 200), verdict: args.verdict, reason: args.reason, screenedAt: now });
    if (args.verdict === "pass") return;
    // Alert every customer who dealt with this counterparty recently.
    const rows = await ctx.db.query("transactions").withIndex("by_client_counterparty", (q) => q.eq("clientId", args.clientId).eq("counterpartyKey", key)).order("desc").take(200);
    const byCustomer = new Map<string, Doc<"transactions">[]>();
    for (const row of rows) byCustomer.set(row.customerRef, [...(byCustomer.get(row.customerRef) ?? []), row]);
    for (const [customerRef, txns] of byCustomer) {
      await raiseAlerts(ctx, args.clientId, customerRef, [
        {
          rule: "sanctioned_counterparty",
          severity: args.verdict === "reject" ? "high" : "medium",
          summary: `Counterparty "${args.name}" ${args.verdict === "reject" ? "matches" : "may match"} a sanctions or watch list: ${args.reason}`.slice(0, 600),
          transactionIds: txns.map((txn) => txn._id),
          key: `counterparty:${key}:${Math.floor(now / SCREENING_TTL_MS)}`,
        },
      ]);
    }
  },
});

// ── Portal ────────────────────────────────────────────────────────────────

export const alerts = query({
  args: { clientId: v.id("clients"), status: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("escalated"))) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const status = args.status ?? "open";
    const rows = await ctx.db.query("transactionAlerts").withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", status)).order("desc").take(200);
    const open = status === "open" ? rows.length : (await ctx.db.query("transactionAlerts").withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "open")).take(500)).length;
    return { open, rows: rows.map((row) => ({ _id: row._id, customerRef: row.customerRef, rule: row.rule, severity: row.severity, status: row.status, summary: row.summary, count: row.transactionIds.length, createdAt: row.createdAt })) };
  },
});

export const alert = query({
  args: { alertId: v.id("transactionAlerts") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.alertId);
    if (!row) return null;
    const actor = await requireClientRole(ctx, row.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const txns = (await Promise.all(row.transactionIds.map((id) => ctx.db.get(id)))).filter(Boolean) as Doc<"transactions">[];
    const verification = await ctx.db.query("verifications").withIndex("by_reference", (q) => q.eq("reference", row.customerRef)).first();
    return {
      ...row,
      transactions: txns.sort((a, b) => a.occurredAt - b.occurredAt).map((txn) => ({ _id: txn._id, externalId: txn.externalId, occurredAt: txn.occurredAt, amount: txn.amount, currency: txn.currency, amountUsd: txn.amountUsd, direction: txn.direction, channel: txn.channel, counterpartyName: txn.counterpartyName ?? null, counterpartyCountry: txn.counterpartyCountry ?? null, counterpartyAccount: txn.counterpartyAccount ?? null, narration: txn.narration ?? null })),
      customerCheck: verification && verification.clientId === row.clientId && !verification.purgedAt ? { id: verification._id, type: verification.type } : null,
      // STRs are confidential (strReports.ts): Admins and Reviewers only.
      canReport: STR_ROLES.includes(actor.role),
    };
  },
});

export const decide = mutation({
  args: { alertId: v.id("transactionAlerts"), decision: v.union(v.literal("closed"), v.literal("escalated")), notes: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.alertId);
    if (!row) throw new ConvexError({ code: "not_found", message: "Alert not found." });
    const actor = await requireClientRole(ctx, row.clientId, REVIEW_WORK_ROLES);
    if (row.status !== "open") throw new ConvexError({ code: "invalid_state", message: "This alert was already decided." });
    const notes = args.notes.trim();
    if (notes.length < 10 || notes.length > 2000) throw new ConvexError({ code: "invalid_argument", message: "Explain the decision in 10 to 2000 characters." });
    const now = Date.now();
    await ctx.db.patch(row._id, { status: args.decision, decidedAt: now, decidedBy: actor.userId, decisionNotes: notes });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: args.decision === "closed" ? "transaction_alert.closed" : "transaction_alert.escalated",
      targetType: "transactionAlert",
      targetId: row._id,
      clientId: row.clientId,
      metadata: { rule: row.rule, customerRef: row.customerRef, notes: notes.slice(0, 500) },
    });
  },
});

export const settingsSummary = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"]);
    const [config, rate] = await Promise.all([monitoringConfig(ctx, args.clientId), usdToKes(ctx)]);
    return { config, usdToKes: rate };
  },
});
