import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recordAudit } from "./auditLog";
import { loadWatchlistCoverage } from "./amlPersistence";
import { SOURCE_KEYS, SOURCE_LABELS } from "./lib/amlMatching";
import { OPENSANCTIONS_BASE_URL } from "./lib/openSanctions";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";

// Sentinel Back Office: service health. Three views of every dependency:
// scheduled probes (is it reachable and is our key accepted), configuration
// (is the Convex env var set; never its value), and real traffic (how often
// it failed in the last 7 days and how many verifications that held).

const DAY_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;
const CHECK_RETENTION_MS = 7 * DAY_MS;
const MAX_TRAFFIC_ROWS = 10_000;
const MAX_SIDE_ROWS = 2_000;

type ProbeService = Doc<"serviceHealthChecks">["service"];

export const PROBE_LABELS: Record<ProbeService, string> = {
  deeptrack_live: "DeepTrack Live",
  opensanctions: "OpenSanctions",
  internal_api: "Scanning service (doc scan · IPRS · liveness)",
};

// Env vars the dependencies need. Only presence is ever reported.
const CONFIG: Array<{ key: string; label: string; purpose: string; required: boolean }> = [
  { key: "OPENSANCTIONS_API_KEY", label: "OpenSanctions API key", purpose: "AML screening", required: true },
  { key: "WATCHLIST_UN_CONSOLIDATED_URL", label: "UN watchlist URL", purpose: "AML screening", required: true },
  { key: "WATCHLIST_EU_FSF_URL", label: "EU watchlist URL override", purpose: "AML screening (built-in default)", required: false },
  { key: "WATCHLIST_UK_SANCTIONS_URL", label: "UK watchlist URL override", purpose: "AML screening (built-in default)", required: false },
  { key: "METAMAP_CLIENT_ID", label: "MetaMap client ID", purpose: "Kenya BRS company registry lookup (KYB)", required: false },
  { key: "METAMAP_CLIENT_SECRET", label: "MetaMap client secret", purpose: "Kenya BRS company registry lookup (KYB)", required: false },
  { key: "DEEPTRACK_LIVE_BASE_URL", label: "DeepTrack Live URL", purpose: "Selfie and video liveness", required: true },
  { key: "DEEPTRACK_LIVE_API_KEY", label: "DeepTrack Live API key", purpose: "Selfie and video liveness", required: true },
  { key: "SENTINEL_INTERNAL_API_BASE_URL", label: "Scanning service URL", purpose: "Document scan, IPRS", required: true },
  { key: "SENTINEL_INTERNAL_API_TOKEN", label: "Scanning service token", purpose: "Document scan, IPRS", required: true },
  { key: "LIVENESS_PUBLIC_URL", label: "Liveness link base URL", purpose: "Remote liveness links", required: true },
  { key: "AFRICASTALKING_API_KEY", label: "Africa's Talking API key", purpose: "Liveness SMS", required: false },
  { key: "AFRICASTALKING_USERNAME", label: "Africa's Talking username", purpose: "Liveness SMS", required: false },
  { key: "AFRICASTALKING_CALLBACK_TOKEN", label: "Africa's Talking callback token", purpose: "SMS delivery reports", required: false },
  { key: "TWILIO_ACCOUNT_SID", label: "Twilio account", purpose: "Liveness WhatsApp / SMS fallback", required: false },
  { key: "TWILIO_AUTH_TOKEN", label: "Twilio auth token", purpose: "Liveness WhatsApp / SMS fallback", required: false },
  { key: "ANTHROPIC_API_KEY", label: "Claude API key", purpose: "Adverse media screening", required: false },
  { key: "LIVENESS_CALLBACK_SECRET", label: "Liveness result webhook secret", purpose: "External liveness results", required: false },
];

function envSet(key: string) {
  return Boolean(process.env[key]?.trim());
}

// ── Probes ────────────────────────────────────────────────────────────────

type ProbeResult = { service: ProbeService; ok: boolean; httpStatus?: number; latencyMs?: number; error?: string };

async function probe(
  service: ProbeService,
  url: string,
  headers: Record<string, string>,
  okStatus: (status: number) => boolean,
  describe: (status: number) => string,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    await response.body?.cancel().catch(() => undefined);
    const latencyMs = Date.now() - started;
    const ok = okStatus(response.status);
    return { service, ok, httpStatus: response.status, latencyMs, error: ok ? undefined : describe(response.status) };
  } catch (error) {
    const aborted = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
    return { service, ok: false, error: aborted ? `No response within ${PROBE_TIMEOUT_MS / 1000}s` : "Unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function httpProblem(status: number) {
  if (status === 401 || status === 403) return `API key rejected (HTTP ${status})`;
  if (status === 503) return "Service unavailable or suspended (HTTP 503)";
  return `HTTP ${status}`;
}

export const runHealthChecks = internalAction({
  args: {},
  handler: async (ctx) => {
    const results: ProbeResult[] = [];

    // DeepTrack Live: with a key, the usage endpoint proves the key works too.
    const dtBase = process.env.DEEPTRACK_LIVE_BASE_URL?.trim().replace(/\/$/, "");
    const dtKey = process.env.DEEPTRACK_LIVE_API_KEY?.trim();
    if (!dtBase) {
      results.push({ service: "deeptrack_live", ok: false, error: "DEEPTRACK_LIVE_BASE_URL is not set" });
    } else if (dtKey) {
      results.push(await probe("deeptrack_live", `${dtBase}/v1/client/usage/me`, { "X-API-Key": dtKey }, (s) => s >= 200 && s < 300, httpProblem));
    } else {
      const reach = await probe("deeptrack_live", `${dtBase}/`, {}, (s) => s < 500, httpProblem);
      results.push({ ...reach, ok: false, error: reach.ok ? "Reachable, but DEEPTRACK_LIVE_API_KEY is not set" : reach.error });
    }

    // OpenSanctions: unauthenticated health endpoint (no billable query).
    const osHealth = await probe("opensanctions", `${OPENSANCTIONS_BASE_URL}/healthz`, {}, (s) => s >= 200 && s < 300, httpProblem);
    results.push(
      osHealth.ok && !envSet("OPENSANCTIONS_API_KEY")
        ? { ...osHealth, ok: false, error: "Reachable, but OPENSANCTIONS_API_KEY is not set" }
        : osHealth,
    );

    // Internal scanning service: any non-5xx answer means it's up.
    const internalBase = process.env.SENTINEL_INTERNAL_API_BASE_URL?.trim();
    if (internalBase) {
      results.push(await probe("internal_api", internalBase.replace(/\/$/, "") + "/", {}, (s) => s < 500, httpProblem));
    } else {
      results.push({ service: "internal_api", ok: false, error: "SENTINEL_INTERNAL_API_BASE_URL is not set" });
    }

    await ctx.runMutation(internal.backOfficeHealth._recordChecks, { results, checkedAt: Date.now() });
  },
});

export const _recordChecks = internalMutation({
  args: {
    checkedAt: v.number(),
    results: v.array(
      v.object({
        service: v.union(v.literal("deeptrack_live"), v.literal("opensanctions"), v.literal("internal_api")),
        ok: v.boolean(),
        httpStatus: v.optional(v.number()),
        latencyMs: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const result of args.results) {
      await ctx.db.insert("serviceHealthChecks", { ...result, error: result.error?.slice(0, 300), checkedAt: args.checkedAt });
    }
    const expired = await ctx.db
      .query("serviceHealthChecks")
      .withIndex("by_checked_at", (q) => q.lt("checkedAt", args.checkedAt - CHECK_RETENTION_MS))
      .take(200);
    for (const row of expired) await ctx.db.delete(row._id);
  },
});

// Lets an admin re-run the probes now instead of waiting for the schedule.
export const runChecksNow = mutation({
  args: {},
  handler: async (ctx) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    await ctx.scheduler.runAfter(0, internal.backOfficeHealth.runHealthChecks, {});
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "back_office.health_checks_run",
      targetType: "system",
      targetId: "service_health",
    });
  },
});

// ── Traffic analysis helpers (pure) ───────────────────────────────────────

export type StepName = "liveness" | "faceCheck" | "docScan" | "iprs" | "aml";

// Which dependency each verification step depends on.
export const STEP_SERVICE: Record<StepName, string> = {
  liveness: "Liveness (DeepTrack Live video / scanning service)",
  faceCheck: "DeepTrack Live selfie check",
  docScan: "Document scan (scanning service)",
  iprs: "IPRS (scanning service)",
  aml: "AML lookup (scanning service)",
};

export function stepErrors(result: unknown): StepName[] {
  if (typeof result !== "object" || result === null) return [];
  const record = result as Record<string, unknown>;
  return (Object.keys(STEP_SERVICE) as StepName[]).filter((step) => {
    const value = record[step];
    return typeof value === "object" && value !== null && "error" in value;
  });
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function openSanctionsStatus(result: unknown): string | null {
  const coverage = (result as { coverage?: { openSanctions?: unknown } } | null)?.coverage;
  return typeof coverage?.openSanctions === "string" ? coverage.openSanctions : null;
}

// ── The page query ────────────────────────────────────────────────────────

export const serviceHealth = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const weekAgo = args.now - 7 * DAY_MS;
    const dayAgo = args.now - DAY_MS;

    // Probes: latest result, 24h availability, last success.
    const probes = await Promise.all(
      (Object.keys(PROBE_LABELS) as ProbeService[]).map(async (service) => {
        const recent = await ctx.db
          .query("serviceHealthChecks")
          .withIndex("by_service_and_checked_at", (q) => q.eq("service", service).gte("checkedAt", dayAgo))
          .order("desc")
          .take(200);
        const latest =
          recent[0] ??
          (await ctx.db
            .query("serviceHealthChecks")
            .withIndex("by_service_and_checked_at", (q) => q.eq("service", service))
            .order("desc")
            .first());
        const lastOk = recent.find((row) => row.ok)?.checkedAt ?? null;
        return {
          service,
          label: PROBE_LABELS[service],
          latest: latest
            ? { ok: latest.ok, httpStatus: latest.httpStatus ?? null, latencyMs: latest.latencyMs ?? null, error: latest.error ?? null, checkedAt: latest.checkedAt }
            : null,
          availability24h: recent.length ? Math.round((recent.filter((row) => row.ok).length / recent.length) * 1000) / 10 : null,
          checks24h: recent.length,
          lastOkAt: lastOk,
        };
      }),
    );

    const config = CONFIG.map((item) => ({ ...item, set: envSet(item.key) }));

    // Watchlists.
    const coverage = await loadWatchlistCoverage(ctx, args.now);
    const watchlists = await Promise.all(
      SOURCE_KEYS.map(async (sourceKey) => {
        const source = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey)).first();
        const version = coverage.versions.find((row) => row.sourceKey === sourceKey);
        return {
          sourceKey,
          label: SOURCE_LABELS[sourceKey],
          recordCount: version?.recordCount ?? 0,
          fetchedAt: version?.fetchedAt ?? null,
          stale: version?.stale ?? false,
          missing: coverage.missing.includes(sourceKey),
          lastSuccessfulAt: source?.lastSuccessfulAt ?? null,
          lastError: source?.lastError ?? null,
        };
      }),
    );

    // Verification traffic, last 7 days.
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_created_at", (q) => q.gte("createdAt", weekAgo))
      .order("desc")
      .take(MAX_TRAFFIC_ROWS);
    const clientIds = [...new Set(rows.map((row) => row.clientId))];
    const clientNames = new Map(
      (await Promise.all(clientIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((client) => [client!._id, client!.name]),
    );

    const stepFailures = new Map<StepName, number>();
    let openSanctionsGaps = 0;
    let amlScreened = 0;
    let watchlistGaps = 0;
    const byType = new Map<string, { total: number; failed: number; review: number; latencies: number[] }>();
    const byClient = new Map<string, { name: string; total: number; latencies: number[] }>();
    for (const row of rows) {
      const type = byType.get(row.type) ?? { total: 0, failed: 0, review: 0, latencies: [] };
      type.total += 1;
      if (row.status === "failed") type.failed += 1;
      if (row.verdict === "review") type.review += 1;
      if (row.completedAt !== undefined && row.completedAt >= row.createdAt) type.latencies.push(row.completedAt - row.createdAt);
      byType.set(row.type, type);

      const client = byClient.get(row.clientId) ?? { name: clientNames.get(row.clientId) ?? "Unknown client", total: 0, latencies: [] };
      client.total += 1;
      if (row.completedAt !== undefined && row.completedAt >= row.createdAt) client.latencies.push(row.completedAt - row.createdAt);
      byClient.set(row.clientId, client);

      for (const step of stepErrors(row.result)) stepFailures.set(step, (stepFailures.get(step) ?? 0) + 1);
      if (row.type === "aml" && row.status === "completed") {
        amlScreened += 1;
        const os = openSanctionsStatus(row.result);
        if (os !== null && os !== "screened") openSanctionsGaps += 1;
        const missing = (row.result as { coverage?: { missingSources?: unknown[] } } | null)?.coverage?.missingSources;
        if (Array.isArray(missing) && missing.length > 0) watchlistGaps += 1;
      }
    }
    const summarize = (latencies: number[]) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      return { p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) };
    };

    // Reviews opened by outages, last 7 days.
    const recentReviews = await ctx.db
      .query("reviewQueue")
      .withIndex("by_created_at", (q) => q.gte("createdAt", weekAgo))
      .take(MAX_SIDE_ROWS);
    const outageHolds = recentReviews.filter((item) => /infrastructure failure|unavailable|timeout|not configured/i.test(item.triggerReason)).length;

    // Liveness invitations (SMS / WhatsApp), last 7 days.
    const invitations = (await ctx.db.query("livenessRequests").order("desc").take(MAX_SIDE_ROWS)).filter((row) => row.createdAt >= weekAgo);
    const failureReasons = new Map<string, number>();
    for (const row of invitations) {
      if (row.deliveryStatus === "failed" || row.deliveryStatus === "undelivered") {
        const reason = row.failureReason ?? "Unknown";
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
      }
    }

    // Webhook deliveries to clients, last 7 days.
    const deliveries = (await ctx.db.query("webhookDeliveries").order("desc").take(MAX_SIDE_ROWS)).filter((row) => row.createdAt >= weekAgo);
    const deliveryClientIds = [...new Set(deliveries.map((row) => row.clientId))].filter((id) => !clientNames.has(id));
    for (const client of await Promise.all(deliveryClientIds.map((id) => ctx.db.get(id)))) {
      if (client) clientNames.set(client._id, client.name);
    }
    const failedDeliveries = await Promise.all(
      deliveries
        .filter((row) => row.status === "failed")
        .slice(0, 20)
        .map(async (row) => ({
          _id: row._id,
          clientName: clientNames.get(row.clientId) ?? "Unknown client",
          reference: row.verificationId ? (await ctx.db.get(row.verificationId))?.reference ?? null : (row.payload as { scan_id?: string } | null)?.scan_id ?? null,
          attemptCount: row.attemptCount,
          lastResponseStatus: row.lastResponseStatus ?? null,
          lastAttemptAt: row.lastAttemptAt ?? null,
        })),
    );

    return {
      probes,
      config,
      watchlists,
      traffic: {
        total: rows.length,
        truncated: rows.length === MAX_TRAFFIC_ROWS,
        stepFailures: (Object.keys(STEP_SERVICE) as StepName[])
          .map((step) => ({ step, service: STEP_SERVICE[step], failures: stepFailures.get(step) ?? 0 }))
          .filter((row) => row.failures > 0),
        aml: { screened: amlScreened, openSanctionsGaps, watchlistGaps },
        outageHolds,
        byType: [...byType.entries()]
          .map(([type, stats]) => ({ type, total: stats.total, failed: stats.failed, review: stats.review, ...summarize(stats.latencies) }))
          .sort((a, b) => b.total - a.total),
        byClient: [...byClient.entries()]
          .map(([clientId, stats]) => ({ clientId, name: stats.name, total: stats.total, ...summarize(stats.latencies) }))
          .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
          .slice(0, 10),
      },
      invitations: {
        total: invitations.length,
        delivered: invitations.filter((row) => row.deliveryStatus === "delivered").length,
        sent: invitations.filter((row) => row.deliveryStatus === "sent").length,
        failed: invitations.filter((row) => row.deliveryStatus === "failed" || row.deliveryStatus === "undelivered").length,
        failureReasons: [...failureReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      },
      webhooks: {
        total: deliveries.length,
        delivered: deliveries.filter((row) => row.status === "delivered").length,
        retrying: deliveries.filter((row) => row.status === "retrying" || row.status === "pending").length,
        failed: deliveries.filter((row) => row.status === "failed").length,
        failedDeliveries,
      },
    };
  },
});

// Back Office resend of a client webhook whose retries are exhausted.
export const retryWebhookDelivery = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) throw new ConvexError({ code: "not_found", message: "Delivery not found." });
    if (delivery.status !== "failed") {
      throw new ConvexError({ code: "invalid_state", message: "Only failed deliveries can be resent." });
    }
    await ctx.db.patch(args.deliveryId, { status: "pending", attemptCount: 0, nextRetryAt: undefined });
    await ctx.scheduler.runAfter(0, internal.webhooks.attemptDelivery, { deliveryId: args.deliveryId });
    await recordAudit(ctx, {
      actorId,
      actorType: "internal_admin",
      action: "webhook.resent",
      targetType: "webhookDelivery",
      targetId: args.deliveryId,
      clientId: delivery.clientId,
    });
  },
});
