import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordAudit } from "./auditLog";
import { displayName } from "./reviewQueue";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";

// Sentinel Back Office: risk and compliance. Sanctions/PEP hits and fake-face
// catches, an audit log viewer, compliance report sign-off, and a tracker for
// data subject requests with a view of how long records are kept.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const RISK_WEEKS = 13;
const MAX_FLAGGED = 5_000;
const MAX_VERIFICATIONS = 10_000;
const MAX_AUDIT_ROWS = 2_000;
const RETENTION_COUNT_CAP = 10_000;

// ── Pure helpers (exported for tests) ─────────────────────────────────────

type DeeptrackVerdict = { prediction?: unknown; confidencePct?: unknown };

// A fake-face or deepfake catch from DeepTrack Live in a verification result
// (KYC selfie check, KYC video liveness or hosted liveness capture).
export function fakeFaceCatch(result: unknown): { source: "selfie" | "video"; confidencePct: number | null } | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as { faceCheck?: DeeptrackVerdict; liveness?: { deeptrackLive?: DeeptrackVerdict } };
  const confidence = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  if (record.faceCheck?.prediction === "fake") return { source: "selfie", confidencePct: confidence(record.faceCheck.confidencePct) };
  const video = record.liveness?.deeptrackLive;
  if (video?.prediction === "fake") return { source: "video", confidencePct: confidence(video.confidencePct) };
  return null;
}

export function weeksAgo(at: number, now: number): number {
  return Math.floor((now - at) / WEEK_MS);
}

// ── Risk dashboard ────────────────────────────────────────────────────────

export const riskDashboard = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const since = args.now - RISK_WEEKS * WEEK_MS;

    const flagged = (await ctx.db.query("flaggedEntities").order("desc").take(MAX_FLAGGED)).filter((row) => row.createdAt >= since);
    const verifications = await ctx.db
      .query("verifications")
      .withIndex("by_created_at", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(MAX_VERIFICATIONS);

    const clientIds = [...new Set([...flagged.map((row) => row.clientId), ...verifications.map((row) => row.clientId)])];
    const clientNames = new Map(
      (await Promise.all(clientIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((client) => [client!._id, client!.name]),
    );
    const nameOf = (id: Id<"clients">) => clientNames.get(id) ?? "Unknown client";

    // Hits per week by list, oldest week first.
    const sources = [...new Set(flagged.map((row) => row.source))];
    const weekly = Array.from({ length: RISK_WEEKS }, (_, index) => {
      const ago = RISK_WEEKS - 1 - index;
      const inWeek = flagged.filter((row) => weeksAgo(row.createdAt, args.now) === ago);
      return {
        weekStart: args.now - (ago + 1) * WEEK_MS,
        bySource: Object.fromEntries(sources.map((source) => [source, inWeek.filter((row) => row.source === source).length])),
        total: inWeek.length,
      };
    });

    const count = <K extends string>(rows: Doc<"flaggedEntities">[], key: (row: Doc<"flaggedEntities">) => K | undefined) => {
      const map = new Map<K, { hits: number; critical: number; verifications: Set<string> }>();
      for (const row of rows) {
        const k = key(row);
        if (k === undefined) continue;
        const entry = map.get(k) ?? { hits: 0, critical: 0, verifications: new Set<string>() };
        entry.hits += 1;
        if (row.riskLevel === "critical") entry.critical += 1;
        entry.verifications.add(row.verificationId);
        map.set(k, entry);
      }
      return [...map.entries()]
        .map(([k, entry]) => ({ key: k, hits: entry.hits, critical: entry.critical, verifications: entry.verifications.size }))
        .sort((a, b) => b.hits - a.hits);
    };

    // Outcomes by verification type.
    const outcomes = new Map<string, { total: number; reject: number; review: number }>();
    for (const row of verifications) {
      const entry = outcomes.get(row.type) ?? { total: 0, reject: 0, review: 0 };
      entry.total += 1;
      if (row.verdict === "reject") entry.reject += 1;
      if (row.verdict === "review") entry.review += 1;
      outcomes.set(row.type, entry);
    }

    const catches = verifications
      .map((row) => ({ row, hit: fakeFaceCatch(row.result) }))
      .filter((entry): entry is { row: Doc<"verifications">; hit: NonNullable<ReturnType<typeof fakeFaceCatch>> } => entry.hit !== null);

    return {
      weeks: RISK_WEEKS,
      truncated: verifications.length === MAX_VERIFICATIONS,
      sources,
      weekly,
      totals: {
        hits: flagged.length,
        critical: flagged.filter((row) => row.riskLevel === "critical").length,
        flaggedVerifications: new Set(flagged.map((row) => row.verificationId)).size,
        fakeFaces: catches.length,
      },
      bySource: count(flagged, (row) => row.source),
      byClient: count(flagged, (row) => row.clientId).map((row) => ({ ...row, name: nameOf(row.key as Id<"clients">) })),
      byCountry: count(flagged, (row) => row.matchedCountry?.trim() || undefined).slice(0, 15),
      byProgram: count(flagged, (row) => row.program).slice(0, 10),
      outcomes: [...outcomes.entries()].map(([type, entry]) => ({ type, ...entry })).sort((a, b) => b.total - a.total),
      fakeFaces: catches.slice(0, 25).map(({ row, hit }) => ({
        reference: row.reference,
        clientName: nameOf(row.clientId),
        type: row.type,
        source: hit.source,
        confidencePct: hit.confidencePct,
        verdict: row.verdict ?? null,
        createdAt: row.createdAt,
      })),
    };
  },
});

// ── Audit log viewer ──────────────────────────────────────────────────────

const actorTypeValidator = v.union(
  v.literal("internal_admin"),
  v.literal("reviewer"),
  v.literal("client_api_key"),
  v.literal("client_user"),
  v.literal("system"),
);

export const auditLog = query({
  args: {
    limit: v.number(),
    action: v.optional(v.string()),
    clientId: v.optional(v.string()),
    actorType: v.optional(actorTypeValidator),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), MAX_AUDIT_ROWS);
    const from = args.from ?? 0;
    const to = args.to ?? Number.MAX_SAFE_INTEGER;
    const clientId = args.clientId ? ctx.db.normalizeId("clients", args.clientId) : null;
    const clientOptions = (await ctx.db.query("clients").take(500))
      .map((client) => ({ _id: client._id, name: client.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (args.clientId && !clientId) return { rows: [], actions: [], clientOptions, hasMore: false };

    const base = args.action
      ? ctx.db.query("auditLog").withIndex("by_action_and_timestamp", (q) => q.eq("action", args.action!).gte("timestamp", from).lte("timestamp", to))
      : clientId
        ? ctx.db.query("auditLog").withIndex("by_client_and_timestamp", (q) => q.eq("clientId", clientId).gte("timestamp", from).lte("timestamp", to))
        : ctx.db.query("auditLog").withIndex("by_timestamp", (q) => q.gte("timestamp", from).lte("timestamp", to));
    // Remaining filters apply in memory over a bounded window.
    const scanned = await base.order("desc").take(MAX_AUDIT_ROWS);
    const matching = scanned.filter(
      (row) => (!clientId || row.clientId === clientId) && (!args.actorType || row.actorType === args.actorType),
    );
    const page = matching.slice(0, limit);

    const ids = [...new Set(page.map((row) => row.clientId).filter((id): id is Id<"clients"> => Boolean(id)))];
    const names = new Map((await Promise.all(ids.map((id) => ctx.db.get(id)))).filter(Boolean).map((client) => [client!._id, client!.name]));
    const recentActions = await ctx.db.query("auditLog").withIndex("by_timestamp").order("desc").take(MAX_AUDIT_ROWS);

    return {
      rows: page.map((row) => {
        const metadata = row.metadata === undefined ? "" : JSON.stringify(row.metadata);
        return {
          _id: row._id,
          timestamp: row.timestamp,
          action: row.action,
          actorType: row.actorType,
          actorId: row.actorId,
          targetType: row.targetType,
          targetId: row.targetId,
          clientName: row.clientId ? names.get(row.clientId) ?? null : null,
          metadata: metadata.length > 600 ? `${metadata.slice(0, 600)}…` : metadata,
        };
      }),
      actions: [...new Set(recentActions.map((row) => row.action))].sort(),
      clientOptions,
      // More rows exist beyond this page, or beyond the scan window.
      hasMore: matching.length > limit || scanned.length === MAX_AUDIT_ROWS,
    };
  },
});

// ── Compliance report sign-off ────────────────────────────────────────────

export const signOffReport = mutation({
  args: { reportId: v.id("complianceReports"), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError({ code: "not_found", message: "Report not found." });
    if (report.status !== "completed") throw new ConvexError({ code: "invalid_state", message: "Only a completed report can be signed off." });
    if (report.signedOffAt) throw new ConvexError({ code: "invalid_state", message: "This report is already signed off." });
    const notes = args.notes?.trim().slice(0, 1000) || undefined;
    const name = displayName(await ctx.auth.getUserIdentity());
    const now = Date.now();
    await ctx.db.patch(args.reportId, { signedOffBy: actorId, signedOffByName: name, signedOffAt: now, signOffNotes: notes });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "compliance_report.signed_off",
      targetType: "complianceReport",
      targetId: args.reportId,
      metadata: { exportHash: report.exportHash, periodStart: report.periodStart, periodEnd: report.periodEnd, notes },
    });
  },
});

// ── Data subject requests and retention ──────────────────────────────────

const requestTypeValidator = v.union(v.literal("access"), v.literal("erasure"), v.literal("rectification"), v.literal("objection"));
const requestStatusValidator = v.union(v.literal("open"), v.literal("in_progress"), v.literal("completed"), v.literal("rejected"));

export const dataRequests = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const requests = await ctx.db.query("dataRequests").withIndex("by_received_at").order("desc").take(500);
    const ids = [...new Set(requests.map((row) => row.clientId).filter((id): id is Id<"clients"> => Boolean(id)))];
    const names = new Map((await Promise.all(ids.map((id) => ctx.db.get(id)))).filter(Boolean).map((client) => [client!._id, client!.name]));

    // How long records have been kept: verifications by age.
    const bands: Array<{ label: string; olderThanDays: number; youngerThanDays: number | null }> = [
      { label: "Under 6 months", olderThanDays: 0, youngerThanDays: 182 },
      { label: "6–12 months", olderThanDays: 182, youngerThanDays: 365 },
      { label: "1–2 years", olderThanDays: 365, youngerThanDays: 730 },
      { label: "Over 2 years", olderThanDays: 730, youngerThanDays: null },
    ];
    const retention = await Promise.all(
      bands.map(async (band) => {
        const newest = args.now - band.olderThanDays * DAY_MS;
        const oldest = band.youngerThanDays === null ? 0 : args.now - band.youngerThanDays * DAY_MS;
        const rows = await ctx.db
          .query("verifications")
          .withIndex("by_created_at", (q) => q.gte("createdAt", oldest).lt("createdAt", newest))
          .take(RETENTION_COUNT_CAP + 1);
        return { label: band.label, count: Math.min(rows.length, RETENTION_COUNT_CAP), capped: rows.length > RETENTION_COUNT_CAP };
      }),
    );

    return {
      requests: requests.map((row) => ({
        _id: row._id,
        requestType: row.requestType,
        subject: row.subject,
        clientName: row.clientId ? names.get(row.clientId) ?? null : null,
        status: row.status,
        receivedAt: row.receivedAt,
        dueAt: row.dueAt,
        overdue: (row.status === "open" || row.status === "in_progress") && args.now > row.dueAt,
        notes: row.notes ?? null,
        completedAt: row.completedAt ?? null,
      })),
      retention,
    };
  },
});

export const createDataRequest = mutation({
  args: {
    requestType: requestTypeValidator,
    subject: v.string(),
    clientId: v.optional(v.string()),
    receivedAt: v.number(),
    dueAt: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const subject = args.subject.trim();
    if (subject.length < 3 || subject.length > 200) {
      throw new ConvexError({ code: "invalid_argument", message: "Describe the subject in 3–200 characters, ideally a verification reference." });
    }
    if (!(args.dueAt > args.receivedAt)) throw new ConvexError({ code: "invalid_argument", message: "The due date must be after the date received." });
    const clientId = args.clientId ? ctx.db.normalizeId("clients", args.clientId) : null;
    if (args.clientId && !clientId) throw new ConvexError({ code: "invalid_argument", message: "Unknown client." });
    const now = Date.now();
    const id = await ctx.db.insert("dataRequests", {
      requestType: args.requestType,
      subject,
      clientId: clientId ?? undefined,
      status: "open",
      receivedAt: args.receivedAt,
      dueAt: args.dueAt,
      notes: args.notes?.trim().slice(0, 2000) || undefined,
      createdBy: actorId,
      updatedAt: now,
    });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "data_request.created",
      targetType: "dataRequest",
      targetId: id,
      clientId: clientId ?? undefined,
      metadata: { requestType: args.requestType },
    });
    return id;
  },
});

export const updateDataRequest = mutation({
  args: { requestId: v.id("dataRequests"), status: requestStatusValidator, notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new ConvexError({ code: "not_found", message: "Request not found." });
    const now = Date.now();
    const closed = args.status === "completed" || args.status === "rejected";
    await ctx.db.patch(args.requestId, {
      status: args.status,
      notes: args.notes !== undefined ? args.notes.trim().slice(0, 2000) || undefined : row.notes,
      updatedAt: now,
      completedAt: closed ? now : undefined,
    });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "data_request.updated",
      targetType: "dataRequest",
      targetId: args.requestId,
      clientId: row.clientId,
      metadata: { from: row.status, to: args.status },
    });
  },
});
