import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import type { ClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { displayName, resolveReviewItem } from "./reviewQueue";
import { notify } from "./notifications";
import { profileNames } from "./userProfiles";
import {
  CASE_CATEGORY_LABELS,
  QUEUE_LABELS,
  REVIEW_WORK_ROLES,
  ROLE_LABELS,
  canDecide,
  caseCategoryFor,
  checkDecision,
  deadlineFor,
  decisionRank,
  loadClientSettings,
  priorityFor,
  queueForType,
  type CaseCategory,
  type Queue,
  type ResolvedSettings,
} from "./lib/clientSettings";

// The client team's own review workflow (Reviews in the portal, rules in
// Settings → Review workflow). Every review item a check creates goes
// through queueReview, which applies the client's rules: priority (high-risk
// PEP classes), case category, deadline, automatic assignment and alerts.
// Decisions follow the four-eyes, maker-checker and clearance rules, and
// the final one goes through reviewQueue.resolveReviewItem like a DeepTrack
// reviewer's (verdict, charge, audit, webhook).

const READ_ROLES: ClientRole[] = ["client_admin", "reviewer", "compliance_analyst", "viewer"];
const MAX_OPEN = 500;
const MAX_RESOLVED = 200;
const MAX_NOTES = 2000;

type Priority = "low" | "normal" | "high";

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function forbidden(message: string): never {
  throw new ConvexError({ code: "forbidden", message });
}

export function subjectOf(verification: Pick<Doc<"verifications">, "input" | "reference">): string {
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const name =
    (typeof input.subjectName === "string" && input.subjectName) ||
    (typeof input.businessName === "string" && input.businessName) ||
    [input.firstName, input.lastName].filter((part) => typeof part === "string" && part).join(" ") ||
    (typeof input.expectedName === "string" && input.expectedName) ||
    "";
  return name || verification.reference;
}

export function reportHref(verification: Pick<Doc<"verifications">, "_id" | "type">): string | null {
  switch (verification.type) {
    case "aml":
      return `/aml-check/${verification._id}`;
    case "document":
      return `/idp/${verification._id}`;
    case "idp":
      return `/kyc/${verification._id}`;
    case "kyb":
      return `/kyb/${verification._id}`;
    case "kyi":
      return `/kyi/${verification._id}`;
    default:
      return null;
  }
}

async function flaggedFor(ctx: Pick<QueryCtx, "db">, verificationId: Id<"verifications">) {
  return await ctx.db
    .query("flaggedEntities")
    .withIndex("by_verification", (q) => q.eq("verificationId", verificationId))
    .take(100);
}

function documentFlags(verification: Doc<"verifications">) {
  const flags = (verification.result as { flags?: unknown } | null)?.flags;
  return Array.isArray(flags) ? (flags as Array<{ code: string; severity: string }>) : [];
}

async function categoryOf(ctx: Pick<QueryCtx, "db">, row: Doc<"reviewQueue">, verification: Doc<"verifications"> | null): Promise<CaseCategory> {
  if (row.caseCategory) return row.caseCategory as CaseCategory;
  if (!verification) return row.priority === "high" ? "high_risk" : "standard";
  return caseCategoryFor({ type: verification.type, priority: row.priority, flagged: await flaggedFor(ctx, verification._id), documentFlags: documentFlags(verification) });
}

// The client user who ran the check, for maker-checker (API-key checks have
// no maker).
async function makerOf(ctx: Pick<QueryCtx, "db">, verificationId: Id<"verifications">): Promise<string | null> {
  const rows = await ctx.db
    .query("auditLog")
    .withIndex("by_target", (q) => q.eq("targetType", "verification").eq("targetId", verificationId))
    .take(50);
  const created = rows.find((row) => row.action === "verification.created");
  return created && created.actorType === "client_user" ? created.actorId : null;
}

async function activeMembers(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  return (
    await ctx.db
      .query("clientMembers")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .take(1000)
  ).filter((member) => member.isActive);
}

async function openRows(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  const [pending, inReview] = await Promise.all([
    ctx.db.query("reviewQueue").withIndex("by_client_and_status", (q) => q.eq("clientId", clientId).eq("status", "pending")).take(MAX_OPEN),
    ctx.db.query("reviewQueue").withIndex("by_client_and_status", (q) => q.eq("clientId", clientId).eq("status", "in_review")).take(MAX_OPEN),
  ]);
  return [...pending, ...inReview];
}

// Automatic assignment: the eligible member with the fewest open cases
// (longest-standing member first on a tie).
async function pickAssignee(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">, queue: Queue) {
  const members = (await activeMembers(ctx, clientId)).filter(
    (member) => REVIEW_WORK_ROLES.includes(member.role) && (!member.queues?.length || member.queues.includes(queue)),
  );
  if (members.length === 0) return null;
  const load = new Map<string, number>();
  for (const row of await openRows(ctx, clientId)) {
    if (row.clientAssignedTo) load.set(row.clientAssignedTo, (load.get(row.clientAssignedTo) ?? 0) + 1);
  }
  members.sort((a, b) => (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0) || a.createdAt - b.createdAt);
  const chosen = members[0];
  const names = await profileNames(ctx, [chosen.userId]);
  return { userId: chosen.userId, name: names.get(chosen.userId) };
}

function link(reviewId: Id<"reviewQueue">) {
  return `/reviews/${reviewId}`;
}

// Inserts a review item under the client's rules and sends its alerts. Use
// this instead of inserting into reviewQueue directly.
export async function queueReview(
  ctx: MutationCtx,
  fields: {
    verificationId: Id<"verifications">;
    clientId: Id<"clients">;
    triggerType: Doc<"reviewQueue">["triggerType"];
    triggerReason: string;
    priority: Priority;
    monitoring?: boolean;
  },
): Promise<Id<"reviewQueue">> {
  const now = Date.now();
  const [verification, settings] = await Promise.all([ctx.db.get(fields.verificationId), loadClientSettings(ctx, fields.clientId)]);
  const flagged = await flaggedFor(ctx, fields.verificationId);
  const priority = priorityFor(fields.priority, flagged, settings.screening);
  const category = verification
    ? caseCategoryFor({ type: verification.type, priority, flagged, documentFlags: documentFlags(verification) })
    : priority === "high"
      ? "high_risk"
      : "standard";
  const queue = verification ? queueForType(verification.type) : "kyc";
  // A dispute is DeepTrack's to decide: no team assignment or alerts.
  const dispute = fields.triggerType === "client_dispute";
  const assignee = !dispute && settings.review.assignment === "round_robin" ? await pickAssignee(ctx, fields.clientId, queue) : null;

  const reviewId = await ctx.db.insert("reviewQueue", {
    verificationId: fields.verificationId,
    clientId: fields.clientId,
    triggerType: fields.triggerType,
    triggerReason: fields.triggerReason,
    priority,
    status: "pending",
    caseCategory: category,
    queue,
    dueAt: deadlineFor(now, priority, settings.review),
    ...(assignee ? { clientAssignedTo: assignee.userId, clientAssignedToName: assignee.name, clientAssignedAt: now } : {}),
    createdAt: now,
  });

  const subject = verification ? subjectOf(verification) : "a check";
  const reason = fields.triggerReason.slice(0, 300);
  if (dispute) {
    // No alert: the team raised it.
  } else if (fields.monitoring) {
    await notify(ctx, { clientId: fields.clientId, event: "monitoring_alert", title: `Monitoring alert: ${subject}`, body: reason, link: link(reviewId) });
  } else if (category === "sanctions") {
    await notify(ctx, { clientId: fields.clientId, event: "sanctions_hit", title: `Sanctions hit: ${subject}`, body: reason, link: link(reviewId) });
  } else if (category === "pep") {
    await notify(ctx, { clientId: fields.clientId, event: "pep_hit", title: `PEP hit: ${subject}`, body: reason, link: link(reviewId) });
  } else if (priority === "high") {
    await notify(ctx, { clientId: fields.clientId, event: "high_risk_case", title: `High-risk case: ${subject}`, body: reason, link: link(reviewId) });
  }
  if (assignee) {
    await notify(ctx, {
      clientId: fields.clientId,
      event: "review_assigned",
      title: `Case assigned to you: ${subject}`,
      body: `${CASE_CATEGORY_LABELS[category]} in the ${QUEUE_LABELS[queue]} queue, due ${new Date(deadlineFor(now, priority, settings.review)).toUTCString()}.`,
      link: link(reviewId),
      userIds: [assignee.userId],
    });
  }
  return reviewId;
}

// ── Views ───────────────────────────────────────────────────────────────────

type Actor = { userId: string; role: ClientRole | "internal_admin" };

function decisionFor(actor: Actor, row: Doc<"reviewQueue">, category: CaseCategory, rules: ResolvedSettings["review"], makerId: string | null) {
  if (row.status === "resolved") return { canAct: false, final: false, reason: row.withdrawnAt ? "The dispute was withdrawn." : "This case is closed." };
  if (row.triggerType === "client_dispute") return { canAct: false, final: false, reason: "Your team disputed this result. DeepTrack decides it, and you'll be notified." };
  const check = checkDecision({ actor, category, rules, makerId, recommendation: row.recommendation ?? null });
  return check.ok ? { canAct: true, final: check.final, reason: null } : { canAct: false, final: false, reason: check.reason };
}

function summary(row: Doc<"reviewQueue">, verification: Doc<"verifications"> | null, now: number, names: Map<string, string>) {
  const category = (row.caseCategory as CaseCategory | undefined) ?? (row.priority === "high" ? "high_risk" : "standard");
  const queue = (row.queue as Queue | undefined) ?? (verification ? queueForType(verification.type) : "kyc");
  return {
    _id: row._id,
    createdAt: row.createdAt,
    status: row.status,
    priority: row.priority,
    category,
    categoryLabel: CASE_CATEGORY_LABELS[category],
    queue,
    queueLabel: QUEUE_LABELS[queue],
    dueAt: row.dueAt ?? null,
    overdue: row.status !== "resolved" && row.dueAt !== undefined && row.dueAt < now,
    triggerReason: row.triggerReason,
    assignee: row.clientAssignedTo ? { userId: row.clientAssignedTo, name: names.get(row.clientAssignedTo) ?? row.clientAssignedToName ?? "Team member" } : null,
    recommendation: row.recommendation
      ? { action: row.recommendation.action, by: row.recommendation.by, byName: names.get(row.recommendation.by) ?? row.recommendation.byName ?? "Team member", at: row.recommendation.at, reasonCode: row.recommendation.reasonCode ?? null }
      : null,
    escalatedAt: row.clientEscalatedAt ?? null,
    resolution:
      row.status === "resolved"
        ? {
            action: row.resolutionAction ?? null,
            verdict: row.resolutionAction === "confirm" ? "pass" : row.resolutionAction === "keep_verdict" ? "reject" : null,
            byName: (row.resolvedBy && names.get(row.resolvedBy)) ?? row.resolvedByName ?? null,
            source: row.decisionSource ?? null,
            reasonCode: row.reasonCode ?? null,
            at: row.resolvedAt ?? null,
          }
        : null,
    verification: verification
      ? { _id: verification._id, type: verification.type, reference: verification.reference, verdict: verification.verdict ?? null, subject: subjectOf(verification), href: reportHref(verification) }
      : null,
  };
}

const viewValidator = v.union(
  v.literal("mine"),
  v.literal("unassigned"),
  v.literal("awaiting_approval"),
  v.literal("overdue"),
  v.literal("open"),
  v.literal("resolved"),
);

export const list = query({
  args: { clientId: v.id("clients"), view: viewValidator, queue: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, READ_ROLES);
    const now = Date.now();
    const settings = await loadClientSettings(ctx, args.clientId);
    const rows =
      args.view === "resolved"
        ? await ctx.db
            .query("reviewQueue")
            .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "resolved"))
            .order("desc")
            .take(MAX_RESOLVED)
        : await openRows(ctx, args.clientId);
    const verifications = await Promise.all(rows.map((row) => ctx.db.get(row.verificationId)));
    const names = await profileNames(ctx, rows.flatMap((row) => [row.clientAssignedTo, row.recommendation?.by, row.resolvedBy].filter(Boolean) as string[]));
    const items = rows.map((row, index) => ({ row, item: summary(row, verifications[index], now, names) }));
    const filtered = items.filter(({ row, item }) => {
      if (args.queue && item.queue !== args.queue) return false;
      switch (args.view) {
        case "mine":
          return row.clientAssignedTo === actor.userId;
        case "unassigned":
          return !row.clientAssignedTo;
        case "awaiting_approval":
          return Boolean(row.recommendation) && row.recommendation!.by !== actor.userId && canDecide(actor.role, settings.review.clearance[item.category]);
        case "overdue":
          return item.overdue;
        default:
          return true;
      }
    });
    const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
    if (args.view !== "resolved") {
      filtered.sort(
        (a, b) =>
          Number(b.item.overdue) - Number(a.item.overdue) ||
          priorityRank[a.item.priority] - priorityRank[b.item.priority] ||
          (a.item.dueAt ?? a.item.createdAt) - (b.item.dueAt ?? b.item.createdAt),
      );
    }
    return filtered.map(({ item }) => item);
  },
});

export const counts = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, READ_ROLES);
    const now = Date.now();
    const settings = await loadClientSettings(ctx, args.clientId);
    const rows = await openRows(ctx, args.clientId);
    let mine = 0;
    let unassigned = 0;
    let awaitingApproval = 0;
    let overdue = 0;
    for (const row of rows) {
      if (row.clientAssignedTo === actor.userId) mine += 1;
      if (!row.clientAssignedTo) unassigned += 1;
      if (row.dueAt !== undefined && row.dueAt < now) overdue += 1;
      const category = (row.caseCategory as CaseCategory | undefined) ?? "standard";
      if (row.recommendation && row.recommendation.by !== actor.userId && canDecide(actor.role, settings.review.clearance[category])) awaitingApproval += 1;
    }
    return { open: rows.length, mine, unassigned, awaitingApproval, overdue };
  },
});

const HISTORY_ACTIONS = /^(verification\.(created|disputed|dispute_withdrawn)|review\.|aml\.|document\.)/;

export const get = query({
  args: { reviewId: v.string() },
  handler: async (ctx, args) => {
    const reviewId = ctx.db.normalizeId("reviewQueue", args.reviewId);
    if (!reviewId) return null;
    const row = await ctx.db.get(reviewId);
    if (!row) return null;
    const actor = await requireClientRole(ctx, row.clientId, READ_ROLES);
    const now = Date.now();
    const [verification, settings, makerId, audit] = await Promise.all([
      ctx.db.get(row.verificationId),
      loadClientSettings(ctx, row.clientId),
      makerOf(ctx, row.verificationId),
      ctx.db
        .query("auditLog")
        .withIndex("by_target", (q) => q.eq("targetType", "verification").eq("targetId", row.verificationId))
        .take(100),
    ]);
    const category = await categoryOf(ctx, row, verification);
    const flagged = verification ? await flaggedFor(ctx, verification._id) : [];
    const history = audit.filter((entry) => HISTORY_ACTIONS.test(entry.action)).sort((a, b) => a.timestamp - b.timestamp);
    const names = await profileNames(ctx, [
      ...history.map((entry) => entry.actorId),
      ...([row.clientAssignedTo, row.recommendation?.by, row.resolvedBy, makerId].filter(Boolean) as string[]),
    ]);
    const item = summary(row, verification, now, names);
    const decision = decisionFor(actor, row, category, settings.review, makerId);
    const rank = decisionRank(actor.role);
    return {
      ...item,
      clientId: row.clientId,
      category,
      categoryLabel: CASE_CATEGORY_LABELS[category],
      recommendationNotes: row.recommendation?.notes ?? null,
      resolutionNotes: row.resolutionNotes ?? null,
      result: verification
        ? {
            status: verification.status,
            reason: ((verification.result as { reason?: unknown } | null)?.reason as string | undefined) ?? null,
            confidence: verification.confidence ?? null,
            createdAt: verification.createdAt,
          }
        : null,
      hits: flagged.slice(0, 20).map((hit) => ({
        entityName: hit.entityName,
        source: hit.source,
        program: hit.program,
        matchScore: hit.matchScore,
        categories: hit.categories ?? [],
        pepClass: hit.pepClass ?? null,
        riskLevel: hit.riskLevel,
      })),
      documentFlags: verification ? documentFlags(verification).slice(0, 20) : [],
      maker: makerId ? { userId: makerId, name: names.get(makerId) ?? "Team member" } : null,
      rules: {
        fourEyes: settings.review.fourEyes.includes(category),
        clearanceRole: settings.review.clearance[category],
        clearanceLabel: ROLE_LABELS[settings.review.clearance[category]],
        makerChecker: settings.review.makerChecker,
        requireReasonCode: settings.review.requireReasonCode,
        approveReasons: settings.review.approveReasons,
        rejectReasons: settings.review.rejectReasons,
      },
      me: {
        userId: actor.userId,
        role: actor.role,
        canWork: rank > 0,
        canAssignOthers: rank >= 2,
        decision,
        canSendBack:
          Boolean(row.recommendation) &&
          row.status !== "resolved" &&
          row.recommendation!.by !== actor.userId &&
          canDecide(actor.role, settings.review.clearance[category]),
      },
      history: history.map((entry) => ({
        _id: entry._id,
        action: entry.action,
        actorName: entry.actorType === "system" ? "Sentinel" : entry.actorType === "client_api_key" ? "API key" : names.get(entry.actorId) ?? (entry.actorType === "reviewer" ? "DeepTrack reviewer" : "Team member"),
        at: entry.timestamp,
        notes: ((entry.metadata as { notes?: unknown } | null)?.notes as string | undefined) ?? null,
        reasonCode: ((entry.metadata as { reasonCode?: unknown } | null)?.reasonCode as string | undefined) ?? null,
      })),
    };
  },
});

// ── Actions ─────────────────────────────────────────────────────────────────

async function loadOpen(ctx: MutationCtx, reviewId: Id<"reviewQueue">) {
  const row = await ctx.db.get(reviewId);
  if (!row) throw new ConvexError({ code: "not_found", message: "Case not found." });
  const actor = await requireClientRole(ctx, row.clientId, REVIEW_WORK_ROLES);
  if (row.status === "resolved") invalid("This case is already closed.");
  // A dispute challenges the result, so DeepTrack decides it (disputes.ts).
  if (row.triggerType === "client_dispute") forbidden("DeepTrack decides disputes. You can withdraw the dispute instead.");
  return { row, actor };
}

function cleanNotes(notes: string | undefined) {
  const trimmed = notes?.trim() || undefined;
  if (trimmed && trimmed.length > MAX_NOTES) invalid(`Notes are limited to ${MAX_NOTES} characters.`);
  return trimmed;
}

async function auditCase(ctx: MutationCtx, actor: Actor, row: Doc<"reviewQueue">, action: string, metadata: Record<string, unknown>) {
  await recordAudit(ctx, {
    actorId: actor.userId,
    actorType: actorTypeForClientRole(actor.role),
    action,
    targetType: "verification",
    targetId: row.verificationId,
    clientId: row.clientId,
    metadata: { reviewId: row._id, ...metadata },
  });
}

async function caseTitle(ctx: Pick<QueryCtx, "db">, row: Doc<"reviewQueue">) {
  const verification = await ctx.db.get(row.verificationId);
  return verification ? subjectOf(verification) : "a case";
}

export const assign = mutation({
  args: { reviewId: v.id("reviewQueue"), to: v.union(v.literal("me"), v.literal("nobody"), v.string()) },
  handler: async (ctx, args) => {
    const { row, actor } = await loadOpen(ctx, args.reviewId);
    const senior = decisionRank(actor.role) >= 2;
    const target = args.to === "me" ? actor.userId : args.to === "nobody" ? null : args.to;
    if (target === row.clientAssignedTo) return null;
    if (!senior) {
      if (target !== null && target !== actor.userId) forbidden("Only Reviewers and Admins can assign cases to others.");
      if (row.clientAssignedTo && row.clientAssignedTo !== actor.userId) forbidden("This case is assigned to someone else. Ask a Reviewer or Admin to reassign it.");
    }
    let name: string | undefined;
    if (target) {
      const member = await ctx.db
        .query("clientMembers")
        .withIndex("by_client_and_user", (q) => q.eq("clientId", row.clientId).eq("userId", target))
        .unique();
      const isSelfInternal = target === actor.userId && actor.role === "internal_admin";
      if (!isSelfInternal && (!member || !member.isActive || !REVIEW_WORK_ROLES.includes(member.role))) invalid("Cases can only be assigned to active Admins, Reviewers and Analysts.");
      name = target === actor.userId ? displayName(await ctx.auth.getUserIdentity()) : (await profileNames(ctx, [target])).get(target);
    }
    const now = Date.now();
    await ctx.db.patch(row._id, target ? { clientAssignedTo: target, clientAssignedToName: name, clientAssignedAt: now } : { clientAssignedTo: undefined, clientAssignedToName: undefined, clientAssignedAt: undefined });
    await auditCase(ctx, actor, row, "review.assigned", { from: row.clientAssignedTo ?? null, to: target });
    if (target && target !== actor.userId) {
      await notify(ctx, {
        clientId: row.clientId,
        event: "review_assigned",
        title: `Case assigned to you: ${await caseTitle(ctx, row)}`,
        body: row.triggerReason.slice(0, 300),
        link: link(row._id),
        userIds: [target],
      });
    }
    return null;
  },
});

export const decide = mutation({
  args: {
    reviewId: v.id("reviewQueue"),
    action: v.union(v.literal("approve"), v.literal("reject")),
    reasonCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { row, actor } = await loadOpen(ctx, args.reviewId);
    const verification = await ctx.db.get(row.verificationId);
    const [settings, makerId, category] = await Promise.all([loadClientSettings(ctx, row.clientId), makerOf(ctx, row.verificationId), categoryOf(ctx, row, verification)]);
    const rules = settings.review;
    const check = checkDecision({ actor, category, rules, makerId, recommendation: row.recommendation ?? null });
    if (!check.ok) forbidden(check.reason);

    const notes = cleanNotes(args.notes);
    const reasonCode = args.reasonCode?.trim() || undefined;
    const reasons = args.action === "approve" ? rules.approveReasons : rules.rejectReasons;
    if (rules.requireReasonCode && !reasonCode) invalid("Choose a reason for this decision.");
    if (reasonCode && !reasons.includes(reasonCode)) invalid("That reason isn't on your organization's list. Pick one from the list.");
    if (args.action === "reject" && !reasonCode && !notes) invalid("Add a reason or notes for a rejection.");
    const actorName = displayName(await ctx.auth.getUserIdentity());

    if (check.final) {
      const recommendation = row.recommendation;
      const outcome = await resolveReviewItem(ctx, {
        reviewerId: actor.userId,
        reviewerName: actorName,
        reviewRow: row,
        action: args.action === "approve" ? "confirm" : "keep_verdict",
        notes,
        client: {
          actorType: actor.role === "internal_admin" ? "internal_admin" : "client_user",
          reasonCode,
          ...(recommendation ? { approvedBy: actor.userId, approvedByName: actorName, recommendedBy: recommendation.by } : {}),
        },
      });
      return { final: true, verdict: outcome.status === "resolved" ? outcome.verdict : null };
    }

    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "in_review",
      recommendation: { action: args.action, reasonCode, notes, by: actor.userId, byName: actorName, role: actor.role, at: now },
    });
    await auditCase(ctx, actor, row, "review.recommended", { recommendation: args.action, reasonCode, notes, category });
    // Tell the people who can approve it (not the recommender or the maker).
    const approvers = (await activeMembers(ctx, row.clientId))
      .filter((member) => canDecide(member.role, rules.clearance[category]) && member.userId !== actor.userId && !(rules.makerChecker && member.userId === makerId))
      .map((member) => member.userId);
    await notify(ctx, {
      clientId: row.clientId,
      event: "awaiting_approval",
      title: `Approval needed: ${verification ? subjectOf(verification) : "a case"}`,
      body: `${actorName ?? "A team member"} recommends to ${args.action}${reasonCode ? ` (${reasonCode})` : ""}. ${CASE_CATEGORY_LABELS[category]} cases need a second person.`,
      link: link(row._id),
      userIds: approvers,
    });
    return { final: false, verdict: null };
  },
});

// Returns a recommendation to the team without deciding it.
export const sendBack = mutation({
  args: { reviewId: v.id("reviewQueue"), notes: v.string() },
  handler: async (ctx, args) => {
    const { row, actor } = await loadOpen(ctx, args.reviewId);
    if (!row.recommendation) invalid("There's no recommendation to send back.");
    const verification = await ctx.db.get(row.verificationId);
    const settings = await loadClientSettings(ctx, row.clientId);
    const category = await categoryOf(ctx, row, verification);
    if (row.recommendation.by === actor.userId || !canDecide(actor.role, settings.review.clearance[category])) {
      forbidden("Only someone who can approve this case can send the recommendation back.");
    }
    const notes = cleanNotes(args.notes);
    if (!notes) invalid("Say why you're sending it back.");
    await ctx.db.patch(row._id, { recommendation: undefined, status: "pending" });
    await auditCase(ctx, actor, row, "review.sent_back", { notes, recommendation: row.recommendation.action, recommendedBy: row.recommendation.by });
    await notify(ctx, {
      clientId: row.clientId,
      event: "review_assigned",
      title: `Recommendation sent back: ${verification ? subjectOf(verification) : "a case"}`,
      body: notes,
      link: link(row._id),
      userIds: [row.recommendation.by],
    });
    return null;
  },
});

export const escalate = mutation({
  args: { reviewId: v.id("reviewQueue"), notes: v.string() },
  handler: async (ctx, args) => {
    const { row, actor } = await loadOpen(ctx, args.reviewId);
    const notes = cleanNotes(args.notes);
    if (!notes) invalid("Say why you're escalating the case.");
    const settings = await loadClientSettings(ctx, row.clientId);
    const now = Date.now();
    const highDue = deadlineFor(now, "high", settings.review);
    await ctx.db.patch(row._id, {
      priority: "high",
      clientEscalatedAt: now,
      clientEscalatedBy: actor.userId,
      dueAt: row.dueAt === undefined ? highDue : Math.min(row.dueAt, highDue),
    });
    await auditCase(ctx, actor, row, "review.client_escalated", { notes, previousPriority: row.priority });
    await notify(ctx, {
      clientId: row.clientId,
      event: "case_escalated",
      title: `Case escalated: ${await caseTitle(ctx, row)}`,
      body: notes,
      link: link(row._id),
    });
    return null;
  },
});

// ── Deadlines ───────────────────────────────────────────────────────────────

// Cron (crons.ts): cases past their deadline are raised to high priority
// and the team is alerted once.
export const flagOverdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let flagged = 0;
    for (const status of ["pending", "in_review"] as const) {
      const rows = await ctx.db
        .query("reviewQueue")
        .withIndex("by_status_and_created_at", (q) => q.eq("status", status))
        .take(2000);
      for (const row of rows) {
        if (flagged >= 200) return { flagged };
        if (row.dueAt === undefined || row.dueAt >= now || row.overdueNotifiedAt !== undefined) continue;
        await ctx.db.patch(row._id, { overdueNotifiedAt: now, priority: "high" });
        await recordAudit(ctx, {
          actorId: "system",
          actorType: "system",
          action: "review.overdue",
          targetType: "verification",
          targetId: row.verificationId,
          clientId: row.clientId,
          metadata: { reviewId: row._id, dueAt: row.dueAt },
        });
        const assigned = row.clientAssignedTo ? ` Assigned to ${(await profileNames(ctx, [row.clientAssignedTo])).get(row.clientAssignedTo) ?? "a team member"}.` : " Not assigned.";
        await notify(ctx, {
          clientId: row.clientId,
          event: "review_overdue",
          title: `Missed review deadline: ${await caseTitle(ctx, row)}`,
          body: `The deadline was ${new Date(row.dueAt).toUTCString()}.${assigned}`,
          link: link(row._id),
        });
        flagged += 1;
      }
    }
    return { flagged };
  },
});

// One-off after deploy: gives open cases created before client workflows
// their category, queue and deadline (run from the Convex dashboard).
export const backfillOpen = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const status of ["pending", "in_review"] as const) {
      const rows = await ctx.db
        .query("reviewQueue")
        .withIndex("by_status_and_created_at", (q) => q.eq("status", status))
        .take(2000);
      for (const row of rows) {
        if (row.caseCategory && row.queue && row.dueAt !== undefined) continue;
        const [verification, settings] = await Promise.all([ctx.db.get(row.verificationId), loadClientSettings(ctx, row.clientId)]);
        await ctx.db.patch(row._id, {
          caseCategory: await categoryOf(ctx, row, verification),
          queue: verification ? queueForType(verification.type) : "kyc",
          dueAt: row.dueAt ?? deadlineFor(row.createdAt, row.priority, settings.review),
          // Old cases shouldn't all alert as overdue at once.
          overdueNotifiedAt: row.overdueNotifiedAt ?? Date.now(),
        });
        updated += 1;
      }
    }
    return { updated };
  },
});
