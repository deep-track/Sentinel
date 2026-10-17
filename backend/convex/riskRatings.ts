import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole, requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { loadClientSettings, REVIEW_WORK_ROLES } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { notify } from "./notifications";
import { FATF_DEFAULTS, nextReviewAt, rateCustomer, type RatingConfig, type RatingHit, type RiskRating } from "./lib/riskRating";

// Customer risk ratings (lib/riskRating.ts): set on every AML screening and
// KYB check, recomputed when a reviewer clears the hits, and kept on each
// monitored customer with its next periodic review. A daily cron tells the
// team which customers are due (periodic_review_due).

const READ_ROLES = ["client_admin", "compliance_analyst", "reviewer", "developer", "viewer"] as const;
const LIST_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

async function countrySettings(ctx: Pick<QueryCtx, "db">) {
  const row = await ctx.db.query("riskSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
  return row ?? { ...FATF_DEFAULTS, updatedAt: null, updatedBy: null };
}

export async function ratingConfig(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">): Promise<{ config: RatingConfig; homeCountry: string }> {
  const [countries, settings, client] = await Promise.all([countrySettings(ctx), loadClientSettings(ctx, clientId), ctx.db.get(clientId)]);
  return {
    config: { callForAction: countries.callForAction, increasedMonitoring: countries.increasedMonitoring, reviewMonths: settings.screening.reviewMonths },
    // Kenyan clients (billed in KES) don't score their own country.
    homeCountry: client?.billingCurrency === "KES" ? "KE" : "",
  };
}

type MatchLike = { source?: string; categories?: string[]; pepClass?: number | null; riskLevel?: string };

// The monitored customer a screening belongs to, if any.
async function monitoredSubjectFor(ctx: Pick<QueryCtx, "db">, verification: Doc<"verifications">) {
  const enrolled = await ctx.db.query("amlMonitoredSubjects").withIndex("by_enrolled_verification", (q) => q.eq("enrolledVerificationId", verification._id)).first();
  if (enrolled) return enrolled;
  const reference = (verification.result as { monitoring?: { reference?: string } } | null)?.monitoring?.reference;
  return reference ? await ctx.db.query("amlMonitoredSubjects").withIndex("by_reference", (q) => q.eq("reference", reference)).first() : null;
}

async function storeRating(ctx: MutationCtx, verification: Doc<"verifications">, rating: RiskRating, now: number) {
  const result = (verification.result ?? {}) as Record<string, unknown>;
  await ctx.db.patch(verification._id, { result: { ...result, riskRating: { ...rating, ratedAt: now } } });
  const subject = verification.type === "aml" ? await monitoredSubjectFor(ctx, verification) : null;
  if (subject && subject.status === "active") {
    const due = nextReviewAt(subject.lastReviewedAt ?? subject.createdAt, rating.reviewMonths);
    // A higher rating brings the review forward; never pushes it back.
    const next = due === null ? now : subject.nextReviewAt === undefined ? due : Math.min(subject.nextReviewAt, due);
    await ctx.db.patch(subject._id, { riskRating: { ...rating, ratedAt: now }, nextReviewAt: next, updatedAt: now });
  }
}

// After an AML screening completes (amlPersistence.completeScreening), or
// with no standing hits once a reviewer cleared them.
export async function rateAmlScreening(ctx: MutationCtx, verificationId: Id<"verifications">, options: { cleared?: boolean } = {}) {
  const verification = await ctx.db.get(verificationId);
  if (!verification || verification.type !== "aml") return null;
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const result = (verification.result ?? {}) as { matches?: MatchLike[] };
  const { config, homeCountry } = await ratingConfig(ctx, verification.clientId);
  const hits: RatingHit[] = options.cleared ? [] : (result.matches ?? []).map((match) => ({ source: match.source ?? "", categories: match.categories ?? [], pepClass: match.pepClass ?? null, riskLevel: match.riskLevel }));
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : null);
  const rating = rateCustomer(
    {
      entityType: input.entityType === "entity" ? "entity" : "individual",
      countries: [text("country"), text("nationality"), text("jurisdiction")],
      homeCountry,
      hits,
      verdict: options.cleared ? "pass" : verification.verdict ?? null,
      industry: text("industry"),
      name: text("subjectName"),
    },
    config,
  );
  await storeRating(ctx, verification, rating, Date.now());
  return rating;
}

// After the automated KYB checks (kyb._completeAutomated).
export async function rateKyb(ctx: MutationCtx, verificationId: Id<"verifications">, hits: RatingHit[], options: { cleared?: boolean } = {}) {
  const verification = await ctx.db.get(verificationId);
  if (!verification || verification.type !== "kyb") return null;
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const ownership = ((verification.result as { registry?: { ownership?: { nodes: Array<{ kind: string; depth: number; note: string | null }>; untraced: string[] } } } | null)?.registry?.ownership) ?? null;
  const { config, homeCountry } = await ratingConfig(ctx, verification.clientId);
  const rating = rateCustomer(
    {
      entityType: "entity",
      countries: [typeof input.incorporationCountry === "string" ? input.incorporationCountry : null],
      homeCountry,
      hits: options.cleared ? [] : hits,
      verdict: options.cleared ? "pass" : verification.verdict ?? null,
      industry: typeof input.businessType === "string" ? input.businessType : null,
      name: typeof input.businessName === "string" ? input.businessName : null,
      remoteOnboarding: true,
      ownership: ownership
        ? {
            untraced: ownership.untraced.length,
            layers: Math.max(0, ...ownership.nodes.filter((node) => node.kind === "company").map((node) => node.depth)),
            foreignHolders: ownership.nodes.filter((node) => node.kind === "company" && /foreign/i.test(node.note ?? "")).length,
          }
        : null,
    },
    config,
  );
  await storeRating(ctx, verification, rating, Date.now());
  return rating;
}

// ── Customers and periodic reviews (client portal) ─────────────────────────

export const customers = query({
  args: { clientId: v.id("clients"), dueOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, [...READ_ROLES]);
    const rows = await ctx.db.query("amlMonitoredSubjects").withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "active")).order("desc").take(LIST_LIMIT);
    const now = Date.now();
    const list = rows
      .map((row) => ({
        _id: row._id,
        reference: row.reference,
        subjectName: row.subjectName,
        entityType: row.entityType,
        externalRef: row.externalRef ?? null,
        rating: (row.riskRating as (RiskRating & { ratedAt: number }) | undefined) ?? null,
        nextReviewAt: row.nextReviewAt ?? null,
        lastReviewedAt: row.lastReviewedAt ?? null,
        due: row.nextReviewAt !== undefined && row.nextReviewAt <= now,
        enrolledVerificationId: row.enrolledVerificationId,
      }))
      .filter((row) => !args.dueOnly || row.due);
    const levels = { low: 0, medium: 0, high: 0, prohibited: 0, unrated: 0 };
    for (const row of list) levels[row.rating?.level ?? "unrated"] += 1;
    const order = { prohibited: 0, high: 1, medium: 2, low: 3 } as const;
    list.sort((left, right) => Number(right.due) - Number(left.due) || (order[left.rating?.level ?? "low"] ?? 4) - (order[right.rating?.level ?? "low"] ?? 4) || (left.nextReviewAt ?? Infinity) - (right.nextReviewAt ?? Infinity));
    return { customers: list, levels, due: list.filter((row) => row.due).length };
  },
});

// The team reviewed the customer: next review under the current rating,
// and a fresh screening now.
export const markReviewed = mutation({
  args: { subjectId: v.id("amlMonitoredSubjects"), notes: v.string() },
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.subjectId);
    if (!subject || subject.status !== "active") throw new ConvexError({ code: "not_found", message: "Customer not found." });
    const actor = await requireClientRole(ctx, subject.clientId, [...REVIEW_WORK_ROLES]);
    const notes = args.notes.trim();
    if (notes.length < 5) throw new ConvexError({ code: "invalid_argument", message: "Note what the review covered." });
    const now = Date.now();
    const months = (subject.riskRating as RiskRating | undefined)?.reviewMonths ?? (await loadClientSettings(ctx, subject.clientId)).screening.reviewMonths.medium;
    await ctx.db.patch(subject._id, { lastReviewedAt: now, lastReviewedBy: actor.userId, nextReviewAt: nextReviewAt(now, months) ?? undefined, reviewDueNotifiedAt: undefined, nextScreenAt: now, updatedAt: now });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "aml.periodic_review",
      targetType: "amlMonitoredSubject",
      targetId: subject._id,
      clientId: subject.clientId,
      metadata: { reference: subject.reference, notes: notes.slice(0, 1000), level: (subject.riskRating as RiskRating | undefined)?.level ?? null },
    });
    return null;
  },
});

// Daily cron: one notification per client listing customers newly due.
export const notifyDueReviews = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("amlMonitoredSubjects").withIndex("by_status_and_next_review", (q) => q.eq("status", "active").lte("nextReviewAt", now)).take(2000);
    const byClient = new Map<Id<"clients">, Array<Doc<"amlMonitoredSubjects">>>();
    for (const subject of due) {
      if (subject.reviewDueNotifiedAt !== undefined && now - subject.reviewDueNotifiedAt < 30 * DAY_MS) continue;
      byClient.set(subject.clientId, [...(byClient.get(subject.clientId) ?? []), subject]);
    }
    for (const [clientId, subjects] of byClient) {
      await notify(ctx, {
        clientId,
        event: "periodic_review_due",
        title: `${subjects.length} customer${subjects.length === 1 ? " is" : "s are"} due for periodic review`,
        body: subjects.slice(0, 5).map((subject) => `${subject.subjectName} (${(subject.riskRating as RiskRating | undefined)?.level ?? "unrated"} risk)`).join(", ") + (subjects.length > 5 ? `, and ${subjects.length - 5} more.` : "."),
        link: "/customers",
      });
      for (const subject of subjects) await ctx.db.patch(subject._id, { reviewDueNotifiedAt: now });
    }
    return { clients: byClient.size };
  },
});

// ── FATF country lists (Back Office) ───────────────────────────────────────

export const countryRisk = query({
  args: {},
  handler: async (ctx) => {
    await requireInternalUser(ctx);
    return await countrySettings(ctx);
  },
});

export const saveCountryRisk = mutation({
  args: { callForAction: v.array(v.string()), increasedMonitoring: v.array(v.string()), asOf: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const codes = (values: string[]) => [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
    const callForAction = codes(args.callForAction);
    const increasedMonitoring = codes(args.increasedMonitoring);
    if ([...callForAction, ...increasedMonitoring].some((code) => !/^[A-Z]{2}$/.test(code))) throw new ConvexError({ code: "invalid_argument", message: "Use two-letter ISO country codes (e.g. KE, IR)." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf)) throw new ConvexError({ code: "invalid_argument", message: "Give the FATF statement date as YYYY-MM-DD." });
    const now = Date.now();
    const row = await ctx.db.query("riskSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const fields = { callForAction, increasedMonitoring, asOf: args.asOf, updatedAt: now, updatedBy: actorId };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("riskSettings", { key: "default", ...fields });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_settings.fatf_updated", targetType: "riskSettings", targetId: "default", metadata: { asOf: args.asOf, callForAction, increasedMonitoring } });
    return null;
  },
});
