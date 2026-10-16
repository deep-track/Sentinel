import { ConvexError, v } from "convex/values";
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
// The audit log and the credit ledger are kept (they hold no customer
// documents). Files uploaded to UploadThing aren't deleted from there.

const internalApi: any = internal;
const BATCH = 50;
const ESTIMATE_CAP = 5000;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

async function pastRetention(ctx: { db: any }, clientId: Id<"clients">, cutoff: number) {
  const rows: Array<Doc<"verifications">> = await ctx.db
    .query("verifications")
    .withIndex("by_client_and_created_at", (q: any) => q.eq("clientId", clientId).lt("createdAt", cutoff))
    .take(ESTIMATE_CAP + 1);
  const live = rows.filter((row) => !row.purgedAt);
  return { count: Math.min(live.length, ESTIMATE_CAP), capped: rows.length > ESTIMATE_CAP };
}

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
    if (past.count === 0) invalid("No checks are past the retention period.");
    const purgeId = await ctx.db.insert("retentionPurges", {
      clientId: args.clientId,
      status: "pending_approval",
      retentionMonths: data.retentionMonths,
      cutoff,
      estimated: past.count,
      estimateCapped: past.capped,
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
      metadata: { cutoff, retentionMonths: data.retentionMonths, estimated: past.count },
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

// One batch; schedules itself until done.
export const runPurge = internalMutation({
  args: { purgeId: v.id("retentionPurges") },
  handler: async (ctx, args) => {
    const purge = await ctx.db.get(args.purgeId);
    if (!purge || purge.status !== "running") return;
    // A longer retention period set since the request wins.
    const { data } = await loadClientSettings(ctx, purge.clientId);
    const now = Date.now();
    const cutoff = Math.min(purge.cutoff, retentionCutoff(data.retentionMonths, now));
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_created_at", (q) =>
        purge.cursor === undefined ? q.eq("clientId", purge.clientId).lt("createdAt", cutoff) : q.eq("clientId", purge.clientId).gt("createdAt", purge.cursor).lt("createdAt", cutoff),
      )
      .take(BATCH);

    let purged = purge.purged;
    let held = purge.held;
    let relatedRemoved = purge.relatedRemoved ?? 0;
    const holds = { ...purge.holds };
    for (const verification of rows) {
      if (verification.purgedAt) continue;
      const reason = await holdFor(ctx, verification);
      if (reason) {
        held += 1;
        holds[reason] += 1;
        continue;
      }
      relatedRemoved += await purgeVerification(ctx, verification, purge._id, now);
      purged += 1;
    }

    if (rows.length === BATCH) {
      await ctx.db.patch(purge._id, { cursor: rows[rows.length - 1].createdAt, purged, held, holds, relatedRemoved });
      await ctx.scheduler.runAfter(0, internalApi.retention.runPurge, { purgeId: purge._id });
      return;
    }

    // Cleared-hit memory recorded before the cutoff goes too.
    const cleared = await ctx.db
      .query("amlClearedMatches")
      .withIndex("by_client_and_cleared_at", (q) => q.eq("clientId", purge.clientId).lt("clearedAt", cutoff))
      .take(500);
    for (const row of cleared) await ctx.db.delete(row._id);
    relatedRemoved += cleared.length;

    await ctx.db.patch(purge._id, { status: "completed", purged, held, holds, relatedRemoved, completedAt: now });
    await recordAudit(ctx, {
      actorId: "system",
      actorType: "system",
      action: "retention.purge_completed",
      targetType: "retentionPurge",
      targetId: purge._id,
      clientId: purge.clientId,
      metadata: { cutoff, purged, held, holds, relatedRemoved },
    });
  },
});
