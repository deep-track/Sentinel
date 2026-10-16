import { ConvexError, v } from "convex/values";
import { purgeFaces } from "./faceRecords";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { loadClientSettings } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { displayName } from "./reviewQueue";
import { holdReason, purgedResult, PURGED_INPUT, retentionCutoff, type HoldReason } from "./lib/retention";

// Removing personal data after the retention period (Settings → Audit &
// data, Kenya Data Protection Act s.39). Approve-then-delete:
//   1. an Admin requests removal of the checks past the retention period;
//   2. a second Admin (or a DeepTrack admin) approves it, never the same
//      person;
//   3. runPurge removes them in batches. Each check keeps a minimal record
//      (reference, type, verdict, credits, dates) for billing and the audit
//      trail; its input, result, documents' links, hits, directors,
//      investor profile, registry lookups, webhook payloads and review notes
//      are removed. Checks with an open case, active monitoring or an STR
//      are held and counted.
//   4. then transaction monitoring data: transactions that occurred before
//      the cutoff are deleted (those on an open alert are held), alerts lose
//      the deleted transactions (a decided alert left with none keeps a
//      minimal record: rule, severity, decision, dates), and counterparty
//      screenings last run before the cutoff are deleted.
// The audit log and the credit ledger are kept (they hold no customer
// documents). Files uploaded to UploadThing aren't deleted from there.

const internalApi: any = internal;
const BATCH = 50;
const TXN_BATCH = 200;
const ALERT_BATCH = 50;
const SCREENING_BATCH = 200;
const OPEN_ALERT_CAP = 2000;
const ESTIMATE_CAP = 5000;
const MINIMAL_ALERT_SUMMARY = "Removed after the retention period.";

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

async function pastRetention(ctx: { db: any }, clientId: Id<"clients">, cutoff: number) {
  const rows: Array<Doc<"verifications">> = await ctx.db
    .query("verifications")
    .withIndex("by_client_and_created_at", (q: any) => q.eq("clientId", clientId).lt("createdAt", cutoff))
    .take(ESTIMATE_CAP + 1);
  const live = rows.filter((row) => !row.purgedAt);
  const transactions: Array<Doc<"transactions">> = await ctx.db
    .query("transactions")
    .withIndex("by_client_and_occurred_at", (q: any) => q.eq("clientId", clientId).lt("occurredAt", cutoff))
    .take(ESTIMATE_CAP + 1);
  return {
    count: Math.min(live.length, ESTIMATE_CAP),
    capped: rows.length > ESTIMATE_CAP,
    transactions: Math.min(transactions.length, ESTIMATE_CAP),
    transactionsCapped: transactions.length > ESTIMATE_CAP,
  };
}

const NO_TRANSACTIONS = { removed: 0, held: 0, alertsTrimmed: 0, alertsMinimized: 0, screeningsRemoved: 0 };

function view(row: Doc<"retentionPurges">) {
  return {
    _id: row._id,
    status: row.status,
    retentionMonths: row.retentionMonths,
    cutoff: row.cutoff,
    estimated: row.estimated,
    estimateCapped: row.estimateCapped,
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName ?? "Admin",
    requestedAt: row.requestedAt,
    approvedByName: row.approvedBy ? row.approvedByName ?? "Admin" : null,
    approvedAt: row.approvedAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
    purged: row.purged,
    held: row.held,
    holds: row.holds,
    relatedRemoved: row.relatedRemoved ?? 0,
    estimatedTransactions: row.estimatedTransactions ?? 0,
    transactions: row.transactions ?? NO_TRANSACTIONS,
    completedAt: row.completedAt ?? null,
  };
}

export const overview = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "viewer"]);
    const { data } = await loadClientSettings(ctx, args.clientId);
    const cutoff = retentionCutoff(data.retentionMonths, Date.now());
    const past = await pastRetention(ctx, args.clientId, cutoff);
    const purges = await ctx.db
      .query("retentionPurges")
      .withIndex("by_client_and_requested_at", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(20);
    return {
      retentionMonths: data.retentionMonths,
      cutoff,
      pastRetention: past.count,
      pastRetentionCapped: past.capped,
      pastRetentionTransactions: past.transactions,
      pastRetentionTransactionsCapped: past.transactionsCapped,
      purges: purges.map(view),
      me: { userId: actor.userId, canRequest: actor.role === "client_admin" || actor.role === "internal_admin" },
    };
  },
});

export const request = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const open = await ctx.db
      .query("retentionPurges")
      .withIndex("by_client_and_requested_at", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(20);
    if (open.some((row) => row.status === "pending_approval" || row.status === "running")) invalid("A removal is already waiting for approval or running.");
    const { data } = await loadClientSettings(ctx, args.clientId);
    const now = Date.now();
    const cutoff = retentionCutoff(data.retentionMonths, now);
    const past = await pastRetention(ctx, args.clientId, cutoff);
    if (past.count === 0 && past.transactions === 0) invalid("No checks or transactions are past the retention period.");
    const purgeId = await ctx.db.insert("retentionPurges", {
      clientId: args.clientId,
      status: "pending_approval",
      retentionMonths: data.retentionMonths,
      cutoff,
      estimated: past.count,
      estimateCapped: past.capped,
      estimatedTransactions: past.transactions,
      requestedBy: actor.userId,
      requestedByName: displayName(await ctx.auth.getUserIdentity()),
      requestedAt: now,
      purged: 0,
      held: 0,
      holds: { openCase: 0, monitoring: 0, str: 0, unfinished: 0 },
    });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "retention.purge_requested",
      targetType: "retentionPurge",
      targetId: purgeId,
      clientId: args.clientId,
      metadata: { cutoff, retentionMonths: data.retentionMonths, estimated: past.count, estimatedTransactions: past.transactions },
    });
    return { purgeId };
  },
});

async function loadPending(ctx: MutationCtx, purgeId: Id<"retentionPurges">) {
  const row = await ctx.db.get(purgeId);
  if (!row) throw new ConvexError({ code: "not_found", message: "Removal request not found." });
  const actor = await requireClientRole(ctx, row.clientId, ["client_admin"]);
  if (row.status !== "pending_approval") invalid("This request is no longer waiting for approval.");
  return { row, actor };
}

// Four-eyes: the approver isn't the person who asked.
export const approve = mutation({
  args: { purgeId: v.id("retentionPurges") },
  handler: async (ctx, args) => {
    const { row, actor } = await loadPending(ctx, args.purgeId);
    if (actor.userId === row.requestedBy) invalid("Another Admin, or DeepTrack, must approve your request.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "running", approvedBy: actor.userId, approvedByName: displayName(await ctx.auth.getUserIdentity()), approvedAt: now });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "retention.purge_approved",
      targetType: "retentionPurge",
      targetId: row._id,
      clientId: row.clientId,
      metadata: { cutoff: row.cutoff, estimated: row.estimated, requestedBy: row.requestedBy },
    });
    await ctx.scheduler.runAfter(0, internalApi.retention.runPurge, { purgeId: row._id });
    return null;
  },
});

export const cancel = mutation({
  args: { purgeId: v.id("retentionPurges") },
  handler: async (ctx, args) => {
    const { row, actor } = await loadPending(ctx, args.purgeId);
    await ctx.db.patch(row._id, { status: "cancelled", cancelledBy: actor.userId, cancelledAt: Date.now() });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "retention.purge_cancelled",
      targetType: "retentionPurge",
      targetId: row._id,
      clientId: row.clientId,
      metadata: {},
    });
    return null;
  },
});

async function holdFor(ctx: MutationCtx, verification: Doc<"verifications">): Promise<HoldReason | null> {
  const [reviews, monitored, str] = await Promise.all([
    ctx.db.query("reviewQueue").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(50),
    ctx.db.query("amlMonitoredSubjects").withIndex("by_enrolled_verification", (q) => q.eq("enrolledVerificationId", verification._id)).take(10),
    ctx.db.query("strReports").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).first(),
  ]);
  return holdReason({
    status: verification.status,
    hasOpenCase: reviews.some((row) => row.status !== "resolved"),
    hasActiveMonitoring: monitored.some((row) => row.status === "active"),
    hasStr: str !== null,
  });
}

// Removes one check's personal data and returns how many related rows went.
export async function purgeVerification(ctx: MutationCtx, verification: Doc<"verifications">, purgeId: Id<"retentionPurges">, now: number): Promise<number> {
  let removed = 0;
  const byVerification = (table: "flaggedEntities" | "fraudSignals" | "kybRegistryLookups" | "kyiRecords" | "webhookDeliveries") =>
    ctx.db.query(table).withIndex("by_verification", (q: any) => q.eq("verificationId", verification._id)).take(500);

  for (const table of ["flaggedEntities", "fraudSignals", "kybRegistryLookups", "kyiRecords", "webhookDeliveries"] as const) {
    for (const row of await byVerification(table)) {
      await ctx.db.delete(row._id);
      removed += 1;
    }
  }
  for (const row of await ctx.db.query("kybDirectors").withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", verification._id)).take(500)) {
    await ctx.db.delete(row._id);
    removed += 1;
  }
  for (const row of await ctx.db.query("amlMonitoredSubjects").withIndex("by_enrolled_verification", (q) => q.eq("enrolledVerificationId", verification._id)).take(10)) {
    if (row.status === "removed") {
      await ctx.db.delete(row._id);
      removed += 1;
    }
  }
  removed += await purgeFaces(ctx, verification._id);
  // Review cases stay for the statistics, without their free text.
  for (const row of await ctx.db.query("reviewQueue").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(50)) {
    await ctx.db.patch(row._id, {
      triggerReason: "Removed after the retention period.",
      resolutionNotes: undefined,
      ...(row.recommendation ? { recommendation: { ...row.recommendation, notes: undefined } } : {}),
    });
  }
  for (const row of await ctx.db.query("feedbackLabels").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(50)) {
    if (row.notes) await ctx.db.patch(row._id, { notes: undefined });
  }
  for (const row of await ctx.db.query("livenessRequests").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(50)) {
    await ctx.db.patch(row._id, { contact: "removed", failureReason: undefined });
  }
  await ctx.db.patch(verification._id, {
    input: PURGED_INPUT,
    result: purgedResult(now),
    failureReason: undefined,
    disputeReason: undefined,
    purgedAt: now,
    retentionPurgeId: purgeId,
    updatedAt: now,
  });
  return removed;
}

type Phase = "checks" | "transactions" | "alerts" | "screenings";
type Counts = Pick<Doc<"retentionPurges">, "purged" | "held" | "holds"> & { relatedRemoved: number; transactions: NonNullable<Doc<"retentionPurges">["transactions"]> };
type Step = { done: true } | { done: false; cursor?: number };
type StepArgs = { ctx: MutationCtx; purge: Doc<"retentionPurges">; cutoff: number; cursor: number | undefined; counts: Counts; now: number };

// Checks created before the cutoff, then the cleared-hit memory.
async function checksStep({ ctx, purge, cutoff, cursor, counts, now }: StepArgs): Promise<Step> {
  const rows = await ctx.db
    .query("verifications")
    .withIndex("by_client_and_created_at", (q) =>
      cursor === undefined ? q.eq("clientId", purge.clientId).lt("createdAt", cutoff) : q.eq("clientId", purge.clientId).gt("createdAt", cursor).lt("createdAt", cutoff),
    )
    .take(BATCH);
  for (const verification of rows) {
    if (verification.purgedAt) continue;
    const reason = await holdFor(ctx, verification);
    if (reason) {
      counts.held += 1;
      counts.holds[reason] += 1;
      continue;
    }
    counts.relatedRemoved += await purgeVerification(ctx, verification, purge._id, now);
    counts.purged += 1;
  }
  if (rows.length === BATCH) return { done: false, cursor: rows[rows.length - 1].createdAt };

  // Cleared-hit memory recorded before the cutoff goes too.
  const cleared = await ctx.db
    .query("amlClearedMatches")
    .withIndex("by_client_and_cleared_at", (q) => q.eq("clientId", purge.clientId).lt("clearedAt", cutoff))
    .take(500);
  for (const row of cleared) await ctx.db.delete(row._id);
  counts.relatedRemoved += cleared.length;
  return { done: true };
}

// Transactions that occurred before the cutoff, except those on an open
// alert (held until the alert is decided).
async function transactionsStep({ ctx, purge, cutoff, cursor, counts }: StepArgs): Promise<Step> {
  const rows = await ctx.db
    .query("transactions")
    .withIndex("by_client_and_occurred_at", (q) =>
      cursor === undefined ? q.eq("clientId", purge.clientId).lt("occurredAt", cutoff) : q.eq("clientId", purge.clientId).gt("occurredAt", cursor).lt("occurredAt", cutoff),
    )
    .take(TXN_BATCH);
  if (!rows.length) return { done: true };
  const open = await ctx.db
    .query("transactionAlerts")
    .withIndex("by_client_and_status", (q) => q.eq("clientId", purge.clientId).eq("status", "open"))
    .take(OPEN_ALERT_CAP);
  const onOpenAlert = new Set<string>(open.flatMap((alert) => alert.transactionIds));
  for (const row of rows) {
    if (onOpenAlert.has(row._id)) {
      counts.transactions.held += 1;
      continue;
    }
    await ctx.db.delete(row._id);
    counts.transactions.removed += 1;
  }
  return rows.length === TXN_BATCH ? { done: false, cursor: rows[rows.length - 1].occurredAt } : { done: true };
}

// Alerts drop the transactions just deleted. A decided alert left with none
// keeps a minimal record (rule, severity, decision, who and when).
async function alertsStep({ ctx, purge, cursor, counts }: StepArgs): Promise<Step> {
  if (counts.transactions.removed === 0) return { done: true };
  const rows = await ctx.db
    .query("transactionAlerts")
    .withIndex("by_client_and_created_at", (q) => (cursor === undefined ? q.eq("clientId", purge.clientId) : q.eq("clientId", purge.clientId).gt("createdAt", cursor)))
    .take(ALERT_BATCH);
  for (const alert of rows) {
    const present = await Promise.all(alert.transactionIds.map((id) => ctx.db.get(id)));
    const kept = alert.transactionIds.filter((_, index) => present[index] !== null);
    if (kept.length === alert.transactionIds.length) continue;
    counts.transactions.alertsTrimmed += 1;
    if (kept.length === 0 && alert.status !== "open") {
      await ctx.db.patch(alert._id, { transactionIds: [], summary: MINIMAL_ALERT_SUMMARY, decisionNotes: undefined });
      counts.transactions.alertsMinimized += 1;
    } else {
      await ctx.db.patch(alert._id, { transactionIds: kept });
    }
  }
  return rows.length === ALERT_BATCH ? { done: false, cursor: rows[rows.length - 1].createdAt } : { done: true };
}

// Counterparty screenings not run since the cutoff (the name and the list
// result are personal data).
async function screeningsStep({ ctx, purge, cutoff, counts }: StepArgs): Promise<Step> {
  const rows = await ctx.db
    .query("counterpartyScreenings")
    .withIndex("by_client_and_screened_at", (q) => q.eq("clientId", purge.clientId).lt("screenedAt", cutoff))
    .take(SCREENING_BATCH);
  for (const row of rows) await ctx.db.delete(row._id);
  counts.transactions.screeningsRemoved += rows.length;
  return rows.length === SCREENING_BATCH ? { done: false } : { done: true };
}

const STEPS: Record<Phase, (args: StepArgs) => Promise<Step>> = { checks: checksStep, transactions: transactionsStep, alerts: alertsStep, screenings: screeningsStep };
const NEXT: Record<Phase, Phase | null> = { checks: "transactions", transactions: "alerts", alerts: "screenings", screenings: null };

// One batch per stage; schedules itself until every stage is done.
export const runPurge = internalMutation({
  args: { purgeId: v.id("retentionPurges") },
  handler: async (ctx, args) => {
    const purge = await ctx.db.get(args.purgeId);
    if (!purge || purge.status !== "running") return;
    // A longer retention period set since the request wins.
    const { data } = await loadClientSettings(ctx, purge.clientId);
    const now = Date.now();
    const cutoff = Math.min(purge.cutoff, retentionCutoff(data.retentionMonths, now));
    const counts: Counts = {
      purged: purge.purged,
      held: purge.held,
      holds: { ...purge.holds },
      relatedRemoved: purge.relatedRemoved ?? 0,
      transactions: { ...NO_TRANSACTIONS, ...purge.transactions },
    };

    let phase: Phase = purge.phase ?? "checks";
    let cursor = phase === "checks" ? purge.cursor : purge.phaseCursor;
    for (;;) {
      const step = await STEPS[phase]({ ctx, purge, cutoff, cursor, counts, now });
      if (!step.done) {
        await ctx.db.patch(purge._id, { phase, ...(phase === "checks" ? { cursor: step.cursor } : { phaseCursor: step.cursor }), ...counts });
        await ctx.scheduler.runAfter(0, internalApi.retention.runPurge, { purgeId: purge._id });
        return;
      }
      const next = NEXT[phase];
      if (!next) break;
      phase = next;
      cursor = undefined;
    }

    await ctx.db.patch(purge._id, { status: "completed", phase, phaseCursor: undefined, ...counts, completedAt: now });
    await recordAudit(ctx, {
      actorId: "system",
      actorType: "system",
      action: "retention.purge_completed",
      targetType: "retentionPurge",
      targetId: purge._id,
      clientId: purge.clientId,
      metadata: { cutoff, purged: counts.purged, held: counts.held, holds: counts.holds, relatedRemoved: counts.relatedRemoved, transactions: counts.transactions },
    });
  },
});
