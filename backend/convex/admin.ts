import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { recordAudit } from "./auditLog";
import { loadWatchlistCoverage } from "./amlPersistence";
import { SOURCE_LABELS } from "./lib/amlMatching";
import { getBalance, recordLedgerEntry } from "./lib/credits";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { latencyStats } from "./portal";

// Internal (Sentinel staff) client management and the cross-client ops
// overview. Reads need an internal role; writes need internal_admin and are
// refused for view-only admins. Every write is audited.

const MAX_CLIENTS = 500;
const MAX_DAY_ROWS = 10_000;
const MAX_LEDGER_ROWS = 5000;
const MAX_QUEUE_ROWS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREDIT_CHANGE = 10_000_000;

const planValidator = v.union(
  v.literal("trial"),
  v.literal("starter"),
  v.literal("growth"),
  v.literal("enterprise"),
);
const clientStatusValidator = v.union(v.literal("active"), v.literal("suspended"), v.literal("trial_expired"));

type ClientDoc = Doc<"clients">;

async function creditsUsedSince(ctx: QueryCtx, clientId: Id<"clients">, since: number) {
  const rows = await ctx.db
    .query("creditLedger")
    .withIndex("by_client_created_at", (q) => q.eq("clientId", clientId).gte("createdAt", since))
    .take(MAX_LEDGER_ROWS);
  return Math.max(
    0,
    rows.reduce((total, entry) => {
      if (entry.type === "deduction") return total + Math.abs(entry.amount);
      if (entry.type === "refund") return total - Math.abs(entry.amount);
      return total;
    }, 0),
  );
}

async function clientSummary(ctx: QueryCtx, client: ClientDoc, monthStart: number) {
  const balance = await getBalance(ctx, client._id);
  const usedThisMonth = await creditsUsedSince(ctx, client._id, monthStart);
  return {
    _id: client._id,
    name: client.name,
    plan: client.plan,
    status: client.status,
    creditLimit: client.creditLimit,
    creditThresholdPct: client.creditThresholdPct,
    rpmCap: client.rpmCap,
    balance,
    usedThisMonth,
    // Share of the plan's credit limit consumed this month (null without a limit).
    usagePct: client.creditLimit > 0 ? Math.round((usedThisMonth / client.creditLimit) * 1000) / 10 : null,
    createdAt: client.createdAt,
  };
}

type ClientSummary = Awaited<ReturnType<typeof clientSummary>>;

type Alert = { severity: "critical" | "warning"; title: string; detail?: string; at?: number };

function clientAlerts(client: ClientSummary): Alert[] {
  const alerts: Alert[] = [];
  if (client.status === "suspended") {
    alerts.push({ severity: "warning", title: `${client.name} — account suspended` });
  } else if (client.status === "trial_expired") {
    alerts.push({ severity: "warning", title: `${client.name} — trial expired` });
  }
  if (client.status === "active" && client.balance <= 0) {
    alerts.push({ severity: "critical", title: `${client.name} — 0 credits left`, detail: "New verifications are refused (402)." });
  } else if (client.usagePct !== null && client.usagePct >= client.creditThresholdPct) {
    alerts.push({
      severity: client.usagePct >= 100 ? "critical" : "warning",
      title: `${client.name} — ${client.usagePct}% of monthly credits consumed`,
      detail: `Alert threshold ${client.creditThresholdPct}%.`,
    });
  }
  return alerts;
}

export const listClients = query({
  args: { monthStart: v.number() },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const clients = await ctx.db.query("clients").order("desc").take(MAX_CLIENTS);
    const summaries = await Promise.all(clients.map((client) => clientSummary(ctx, client, args.monthStart)));
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const getClient = query({
  // A string, not v.id: the id comes from the ?client= URL, and a malformed or
  // foreign id must read as "not found" rather than fail validation and crash
  // the page.
  args: { clientId: v.string(), monthStart: v.number(), ledgerLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const clientId = ctx.db.normalizeId("clients", args.clientId);
    if (!clientId) return null;
    const client = await ctx.db.get(clientId);
    if (!client) return null;
    const limit = Math.min(Math.max(Math.floor(args.ledgerLimit ?? 20), 1), 100);
    const ledger = await ctx.db
      .query("creditLedger")
      .withIndex("by_client_created_at", (q) => q.eq("clientId", clientId))
      .order("desc")
      .take(limit);
    return {
      ...(await clientSummary(ctx, client, args.monthStart)),
      ledger: ledger.map((entry) => ({
        _id: entry._id,
        type: entry.type,
        amount: entry.amount,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
    };
  },
});

// Cross-client overview for the Sentinel Back Office. Time boundaries come
// from the browser (queries must not read the wall clock).
export const opsOverview = query({
  args: { now: v.number(), dayStart: v.number(), monthStart: v.number(), recentLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const recentLimit = Math.min(Math.max(Math.floor(args.recentLimit ?? 10), 1), 50);
    const yesterdayStart = args.dayStart - DAY_MS;

    const clientDocs = await ctx.db.query("clients").order("desc").take(MAX_CLIENTS);
    const clients = await Promise.all(clientDocs.map((client) => clientSummary(ctx, client, args.monthStart)));
    const clientNames = new Map(clientDocs.map((client) => [client._id, client.name]));

    const sinceYesterday = await ctx.db
      .query("verifications")
      .withIndex("by_created_at", (q) => q.gte("createdAt", yesterdayStart))
      .order("desc")
      .take(MAX_DAY_ROWS);
    const today = sinceYesterday.filter((row) => row.createdAt >= args.dayStart);
    const yesterday = sinceYesterday.length - today.length;

    const creditsToday = (
      await Promise.all(clientDocs.map((client) => creditsUsedSince(ctx, client._id, args.dayStart)))
    ).reduce((total, used) => total + used, 0);

    const openReviews = (
      await Promise.all(
        (["pending", "in_review"] as const).map((status) =>
          ctx.db
            .query("reviewQueue")
            .withIndex("by_status_and_created_at", (q) => q.eq("status", status))
            .order("desc")
            .take(MAX_QUEUE_ROWS),
        ),
      )
    ).flat();
    const priorityRank = { high: 0, normal: 1, low: 2 } as const;
    const queue = await Promise.all(
      [...openReviews]
        .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || right.createdAt - left.createdAt)
        .slice(0, recentLimit)
        .map(async (item) => {
          const verification = await ctx.db.get(item.verificationId);
          return {
            _id: item._id,
            clientName: clientNames.get(item.clientId) ?? "Unknown client",
            type: verification?.type ?? null,
            reference: verification?.reference ?? null,
            triggerType: item.triggerType,
            triggerReason: item.triggerReason,
            priority: item.priority,
            status: item.status,
            createdAt: item.createdAt,
          };
        }),
    );

    const recent = (
      today.length >= recentLimit
        ? today
        : await ctx.db.query("verifications").withIndex("by_created_at").order("desc").take(recentLimit)
    )
      .slice(0, recentLimit)
      .map((row) => ({
        reference: row.reference,
        clientName: clientNames.get(row.clientId) ?? "Unknown client",
        type: row.type,
        status: row.status,
        verdict: row.verdict ?? null,
        confidence: row.confidence ?? null,
        latencyMs: row.completedAt !== undefined ? row.completedAt - row.createdAt : null,
        createdAt: row.createdAt,
      }));

    const coverage = await loadWatchlistCoverage(ctx, args.now);
    const alerts: Alert[] = [
      ...coverage.missing.map((key) => ({
        severity: "critical" as const,
        title: `${SOURCE_LABELS[key]} watchlist unavailable`,
        detail: withLastError("AML screenings are held for manual review until it is ingested.", coverage.lastErrors[key]),
      })),
      ...coverage.versions
        .filter((version) => version.stale)
        .map((version) => ({
          severity: "warning" as const,
          title: `${SOURCE_LABELS[version.sourceKey]} watchlist is stale`,
          detail: withLastError("AML screenings are held for manual review until it refreshes.", coverage.lastErrors[version.sourceKey]),
          at: version.fetchedAt,
        })),
      ...clients.flatMap(clientAlerts),
    ].sort((left, right) => (left.severity === right.severity ? 0 : left.severity === "critical" ? -1 : 1));

    return {
      stats: {
        activeClients: clients.filter((client) => client.status === "active").length,
        suspendedClients: clients.filter((client) => client.status === "suspended").length,
        trialExpiredClients: clients.filter((client) => client.status === "trial_expired").length,
        scansToday: today.length,
        scansYesterday: yesterday,
        creditsToday,
        openReviews: openReviews.length,
        clientDisputes: openReviews.filter((item) => item.triggerType === "client_dispute").length,
        latency: latencyStats(today),
      },
      clients: clients.sort((left, right) => left.name.localeCompare(right.name)),
      alerts,
      recent,
      queue,
      truncated: sinceYesterday.length === MAX_DAY_ROWS || openReviews.length >= MAX_QUEUE_ROWS,
    };
  },
});

function withLastError(detail: string, lastError: string | undefined) {
  return lastError ? `${detail} Last ingestion error: ${lastError}` : detail;
}

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ConvexError({ code: "invalid_argument", message: "Give a reason (at least 3 characters) for the audit log." });
  }
  if (trimmed.length > 500) throw new ConvexError({ code: "invalid_argument", message: "Reason is too long." });
  return trimmed;
}

export const updateClient = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.optional(v.string()),
    plan: v.optional(planValidator),
    status: v.optional(clientStatusValidator),
    creditLimit: v.optional(v.number()),
    rpmCap: v.optional(v.number()),
    creditThresholdPct: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const reason = requireReason(args.reason);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });

    const patch: Partial<Pick<ClientDoc, "name" | "plan" | "status" | "creditLimit" | "rpmCap" | "creditThresholdPct">> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 200) throw new ConvexError({ code: "invalid_argument", message: "Client name must be 1–200 characters." });
      patch.name = name;
    }
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.status !== undefined) patch.status = args.status;
    if (args.creditLimit !== undefined) {
      if (!Number.isInteger(args.creditLimit) || args.creditLimit < 0 || args.creditLimit > MAX_CREDIT_CHANGE) {
        throw new ConvexError({ code: "invalid_argument", message: "Credit limit must be a whole number from 0 to 10,000,000." });
      }
      patch.creditLimit = args.creditLimit;
    }
    if (args.rpmCap !== undefined) {
      if (!Number.isInteger(args.rpmCap) || args.rpmCap <= 0 || args.rpmCap > 100_000) {
        throw new ConvexError({ code: "invalid_argument", message: "Requests per minute must be a whole number from 1 to 100,000." });
      }
      patch.rpmCap = args.rpmCap;
    }
    if (args.creditThresholdPct !== undefined) {
      if (!Number.isInteger(args.creditThresholdPct) || args.creditThresholdPct < 1 || args.creditThresholdPct > 100) {
        throw new ConvexError({ code: "invalid_argument", message: "Alert threshold must be a whole percentage from 1 to 100." });
      }
      patch.creditThresholdPct = args.creditThresholdPct;
    }

    const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter((key) => patch[key] !== client[key]);
    if (changed.length === 0) return { changed: [] as string[] };
    await ctx.db.patch(args.clientId, patch);
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "client.updated",
      targetType: "client",
      targetId: args.clientId,
      clientId: args.clientId,
      metadata: {
        reason,
        before: Object.fromEntries(changed.map((key) => [key, client[key]])),
        after: Object.fromEntries(changed.map((key) => [key, patch[key]])),
      },
    });
    return { changed: changed as string[] };
  },
});

// Manual credit changes. "allocation" and "refund" add credits; "adjustment"
// may add or remove them but can't take the balance below zero.
export const adjustCredits = mutation({
  args: {
    clientId: v.id("clients"),
    kind: v.union(v.literal("allocation"), v.literal("adjustment"), v.literal("refund")),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const reason = requireReason(args.reason);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
    if (!Number.isInteger(args.amount) || args.amount === 0 || Math.abs(args.amount) > MAX_CREDIT_CHANGE) {
      throw new ConvexError({ code: "invalid_argument", message: "Amount must be a non-zero whole number up to 10,000,000." });
    }
    if (args.kind !== "adjustment" && args.amount < 0) {
      throw new ConvexError({ code: "invalid_argument", message: `A ${args.kind} must be positive. Use an adjustment to remove credits.` });
    }
    const before = await getBalance(ctx, args.clientId);
    if (before + args.amount < 0) {
      throw new ConvexError({ code: "invalid_argument", message: `The balance is ${before}; it can't go below zero.` });
    }
    const after = await recordLedgerEntry(ctx, {
      clientId: args.clientId,
      type: args.kind,
      amount: args.amount,
      reason: `Manual ${args.kind}: ${reason}`,
    });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "client.credits_adjusted",
      targetType: "client",
      targetId: args.clientId,
      clientId: args.clientId,
      metadata: { kind: args.kind, amount: args.amount, before, after, reason },
    });
    return { balance: after };
  },
});
