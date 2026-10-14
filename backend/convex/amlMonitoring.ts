import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { buildVerificationReference } from "./lib/crypto";
import { actorTypeForClientRole, recordAudit, type AuditActorType } from "./auditLog";
import { screenSubjects, type ScreeningSubject } from "./aml";
import { completeScreening, type CompleteScreeningArgs } from "./amlPersistence";
import { loadClientSettings, monitoringIntervalMs } from "./lib/clientSettings";
import {
  INCOMPLETE_RETRY_MS,
  diffHits,
  hitsFromMatches,
  type MonitoredHit,
} from "./lib/amlMonitoringStore";

// Ongoing AML monitoring. A cron (crons.ts) runs runDue, which re-screens
// subjects whose nextScreenAt has passed in batches, compares each complete
// screening with the subject's baseline, and raises an alert (an AML
// verification with result.monitoring, a review item and a webhook) for new
// or more severe hits. Re-screens are not charged.

const internalApi: any = internal;

const BATCH_SIZE = 20;
const MAX_BATCHES_PER_RUN = 10;
const LIST_LIMIT = 100;

function subjectForScreening(subject: Doc<"amlMonitoredSubjects">): ScreeningSubject {
  return {
    subjectName: subject.subjectName,
    entityType: subject.entityType,
    ...(subject.country ? { country: subject.country } : {}),
    ...(subject.aliases?.length ? { aliases: subject.aliases } : {}),
    ...(subject.dateOfBirth ? { dateOfBirth: subject.dateOfBirth } : {}),
    ...(subject.nationality ? { nationality: subject.nationality } : {}),
    ...(subject.idNumber ? { idNumber: subject.idNumber } : {}),
    ...(subject.registrationNumber ? { registrationNumber: subject.registrationNumber } : {}),
    ...(subject.jurisdiction ? { jurisdiction: subject.jurisdiction } : {}),
  };
}

export const _dueSubjects = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("amlMonitoredSubjects")
      .withIndex("by_status_and_next_screen", (q) => q.eq("status", "active").lte("nextScreenAt", args.now))
      .take(args.limit),
});

export const runDue = internalAction({
  args: {},
  handler: async (ctx) => {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const due: Array<Doc<"amlMonitoredSubjects">> = await ctx.runQuery(internalApi.amlMonitoring._dueSubjects, {
        now: Date.now(),
        limit: BATCH_SIZE,
      });
      if (due.length === 0) return { batches: batch };
      // Each subject is screened under its own client's rules.
      const rules = await ctx.runQuery(internalApi.aml._screeningRules, { clientIds: due.map((subject) => subject.clientId) });
      const outcomes = await screenSubjects(ctx, due.map(subjectForScreening), rules);
      for (let index = 0; index < due.length; index++) {
        await ctx.runMutation(internalApi.amlMonitoring._recordRun, {
          subjectId: due[index]._id,
          outcome: outcomes[index],
        });
      }
    }
    // More subjects are due than one run handles: continue right away.
    await ctx.scheduler.runAfter(0, internalApi.amlMonitoring.runDue, {});
    return { batches: MAX_BATCHES_PER_RUN };
  },
});

function hitSummary(hit: MonitoredHit) {
  return { key: hit.key, entityName: hit.entityName, categories: hit.categories, ...(hit.pepClass ? { pepClass: hit.pepClass } : {}) };
}

export const _recordRun = internalMutation({
  // outcome: aml.ScreeningOutcome. The matches are validated again by
  // amlPersistence when an alert is stored.
  args: { subjectId: v.id("amlMonitoredSubjects"), outcome: v.any() },
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.subjectId);
    if (!subject || subject.status !== "active") return;
    const outcome = args.outcome as {
      verdict: "pass" | "review" | "reject";
      reason: string;
      complete: boolean;
      confidence?: number;
      coverage: CompleteScreeningArgs["coverage"];
      matches: CompleteScreeningArgs["matches"];
    };
    const now = Date.now();
    if (!outcome.complete) {
      // A list or OpenSanctions was unavailable: keep the baseline, retry soon.
      await ctx.db.patch(subject._id, { nextScreenAt: now + INCOMPLETE_RETRY_MS, updatedAt: now });
      return;
    }

    // When adverse media couldn't be screened this time, keep its known hits
    // so they aren't "removed" today and alerted again tomorrow.
    const carriedMedia =
      outcome.coverage?.adverseMedia === "screened" ? [] : subject.hits.filter((hit) => hit.source === "ADVERSE_MEDIA");
    const current = [...hitsFromMatches(outcome.matches), ...carriedMedia];
    // Without a baseline (the enrolment screening was incomplete) every hit
    // is new: an incomplete screening can't have cleared anything.
    const { added, escalated, removed } = diffHits(subject.baselineSet ? subject.hits : [], current);
    const alert = added.length > 0 || escalated.length > 0;
    const { screening } = await loadClientSettings(ctx, subject.clientId);
    await ctx.db.patch(subject._id, {
      baselineSet: true,
      hits: current,
      lastScreenedAt: now,
      nextScreenAt: now + monitoringIntervalMs(screening.monitoringFrequency),
      screenCount: subject.screenCount + 1,
      ...(alert ? { alertCount: subject.alertCount + 1, lastAlertAt: now } : {}),
      updatedAt: now,
    });
    if (removed.length > 0) {
      await recordAudit(ctx, {
        actorId: "system",
        actorType: "system",
        action: "aml.monitoring_hits_removed",
        targetType: "amlMonitoredSubject",
        targetId: subject._id,
        clientId: subject.clientId,
        metadata: { reference: subject.reference, removed: removed.map((hit) => hit.key) },
      });
    }
    if (!alert) return;

    const changes = [
      added.length ? `${added.length} new hit${added.length === 1 ? "" : "s"}` : null,
      escalated.length ? `${escalated.length} hit${escalated.length === 1 ? "" : "s"} now more severe` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const verificationId = await ctx.db.insert("verifications", {
      clientId: subject.clientId,
      type: "aml",
      status: "queued",
      creditsUsed: 0,
      input: {
        ...subjectForScreening(subject),
        monitoring: { subject: subject.reference, ...(subject.externalRef ? { externalRef: subject.externalRef } : {}) },
      },
      reference: buildVerificationReference(),
      createdAt: now,
      updatedAt: now,
    });
    await completeScreening(ctx, {
      verificationId,
      clientId: subject.clientId,
      subjectName: subject.subjectName,
      // A new hit always needs a human, even if the screening alone would pass.
      verdict: outcome.verdict === "pass" ? "review" : outcome.verdict,
      reason: `Ongoing monitoring: ${changes}. ${outcome.reason}`,
      confidence: outcome.confidence,
      chargeCredits: false,
      complete: true,
      coverage: outcome.coverage,
      matches: outcome.matches,
      monitoring: {
        subjectId: subject._id,
        reference: subject.reference,
        ...(subject.externalRef ? { externalRef: subject.externalRef } : {}),
        added: added.map(hitSummary),
        escalated: escalated.map(hitSummary),
      },
    });
  },
});

// ── Client access (portal) ─────────────────────────────────────────────────

const READ_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"] as const;
const WRITE_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer"] as const;

function publicSubject(subject: Doc<"amlMonitoredSubjects">) {
  return {
    _id: subject._id,
    reference: subject.reference,
    status: subject.status,
    subjectName: subject.subjectName,
    entityType: subject.entityType,
    country: subject.country ?? null,
    externalRef: subject.externalRef ?? null,
    hits: subject.hits.map(hitSummary),
    screenCount: subject.screenCount,
    alertCount: subject.alertCount,
    lastScreenedAt: subject.lastScreenedAt ?? null,
    lastAlertAt: subject.lastAlertAt ?? null,
    nextScreenAt: subject.status === "active" ? subject.nextScreenAt : null,
    createdAt: subject.createdAt,
    removedAt: subject.removedAt ?? null,
  };
}

export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, [...READ_ROLES]);
    const rows = await ctx.db
      .query("amlMonitoredSubjects")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "active"))
      .order("desc")
      .take(LIST_LIMIT);
    return rows.map(publicSubject);
  },
});

async function removeSubject(
  ctx: MutationCtx,
  subject: Doc<"amlMonitoredSubjects">,
  actor: { actorId: string; actorType: AuditActorType },
) {
  if (subject.status === "removed") return;
  const now = Date.now();
  await ctx.db.patch(subject._id, { status: "removed", removedAt: now, updatedAt: now });
  await recordAudit(ctx, {
    ...actor,
    action: "aml.monitoring_removed",
    targetType: "amlMonitoredSubject",
    targetId: subject._id,
    clientId: subject.clientId,
    metadata: { reference: subject.reference },
  });
}

export const remove = mutation({
  args: { subjectId: v.id("amlMonitoredSubjects") },
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.subjectId);
    if (!subject) throw new ConvexError({ code: "not_found", message: "Monitored subject not found." });
    const { userId, role } = await requireClientRole(ctx, subject.clientId, [...WRITE_ROLES]);
    await removeSubject(ctx, subject, { actorId: userId, actorType: actorTypeForClientRole(role) });
    return null;
  },
});

// ── Public API (http.ts) ───────────────────────────────────────────────────

async function subjectForClient(ctx: { db: QueryCtx["db"] }, reference: string, clientId: Id<"clients">) {
  const subject = await ctx.db
    .query("amlMonitoredSubjects")
    .withIndex("by_reference", (q) => q.eq("reference", reference))
    .unique();
  return subject && subject.clientId === clientId ? subject : null;
}

function apiSubject(subject: Doc<"amlMonitoredSubjects">) {
  const { _id: _internalId, reference, ...rest } = publicSubject(subject);
  return { id: reference, ...rest };
}

export const _listForApi = internalQuery({
  args: { clientId: v.id("clients"), limit: v.number(), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("amlMonitoredSubjects")
      .withIndex("by_client_and_status", (q) => {
        const scoped = q.eq("clientId", args.clientId).eq("status", "active");
        return args.before === undefined ? scoped : scoped.lt("createdAt", args.before);
      })
      .order("desc")
      .take(args.limit + 1);
    const page = rows.slice(0, args.limit);
    return {
      subjects: page.map(apiSubject),
      nextCursor: rows.length > args.limit ? page[page.length - 1].createdAt : null,
    };
  },
});

export const _getForApi = internalQuery({
  args: { clientId: v.id("clients"), reference: v.string() },
  handler: async (ctx, args) => {
    const subject = await subjectForClient(ctx, args.reference, args.clientId);
    return subject ? apiSubject(subject) : null;
  },
});

export const _removeFromApi = internalMutation({
  args: { clientId: v.id("clients"), apiKeyId: v.id("apiKeys"), reference: v.string() },
  handler: async (ctx, args) => {
    const subject = await subjectForClient(ctx, args.reference, args.clientId);
    if (!subject) return false;
    await removeSubject(ctx, subject, { actorId: args.apiKeyId, actorType: "client_api_key" });
    return true;
  },
});
