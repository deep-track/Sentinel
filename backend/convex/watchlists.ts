import { v } from "convex/values";
import { internalAction, internalMutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isInternalAdmin } from "./lib/rbac";
import { currentAccessResult, loadCurrentAccess } from "./lib/access";
import type { SourceKey } from "./lib/amlMatching";
import { parseSource } from "./lib/watchlistParsers";

const DEFAULT_OFAC_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const BATCH_SIZE = 250;
// Abort a source download (headers + body) after this long.
const FETCH_TIMEOUT_MS = 120_000;
// Refuse to activate a version whose record count fell by more than this
// fraction versus the active version (truncated/partial download guard).
const MAX_RECORD_DROP_RATIO = 0.3;

// Garbage collection of superseded/failed versions.
const GC_ENTRY_BATCH = 250;
const GC_MAX_CHAIN_RUNS = 200;
// Superseded versions are kept this long so in-flight screenings that
// started on them can finish paging through their entries.
const SUPERSEDED_RETENTION_MS = 24 * 60 * 60 * 1000;
// A "pending" version older than this belongs to a crashed ingestion run.
const PENDING_ABANDON_MS = 6 * 60 * 60 * 1000;

const sourceKeyValidator = v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"));

const entryValidator = v.object({
  sourceRecordId: v.string(),
  entityType: v.union(v.literal("individual"), v.literal("entity"), v.literal("unknown")),
  primaryName: v.string(),
  aliases: v.array(v.string()),
  normalizedNames: v.array(v.string()),
  countries: v.array(v.string()),
  programs: v.array(v.string()),
  identifiers: v.optional(v.any()),
});

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requireUrl(name: string, fallback?: string): string {
  const value = env(name) ?? fallback;
  if (!value) throw new Error(`${name} is not configured`);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("must use HTTPS");
    return url.toString();
  } catch (error) {
    throw new Error(`${name} is invalid: ${error instanceof Error ? error.message : "invalid URL"}`);
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchSource(sourceKey: SourceKey, sourceUrl: string): Promise<{ body: string; lastModified: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Deeptrack-Sentinel-Watchlist-Ingestion/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${sourceKey} source returned HTTP ${response.status}`);
    const body = await response.text();
    return { body, lastModified: response.headers.get("last-modified") };
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") {
      throw new Error(`${sourceKey} source timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function minimumAcceptedCount(previousRecordCount: number | null): number {
  return previousRecordCount ? Math.ceil(previousRecordCount * (1 - MAX_RECORD_DROP_RATIO)) : 1;
}

async function runIngestion(ctx: ActionCtx, sourceKey: SourceKey, sourceUrl: string, allowRecordDrop: boolean) {
  const startedAt = Date.now();
  const version: { versionId: Id<"watchlistVersions">; previousRecordCount: number | null } = await ctx.runMutation(
    internal.watchlists._startVersion,
    { sourceKey, sourceUrl, startedAt },
  );
  try {
    const { body, lastModified } = await fetchSource(sourceKey, sourceUrl);
    if (body.length < 256) throw new Error(`${sourceKey} source response was unexpectedly small`);
    const entries = parseSource(sourceKey, body);
    if (entries.length === 0) throw new Error(`${sourceKey} source produced zero records`);
    const minimum = minimumAcceptedCount(version.previousRecordCount);
    if (!allowRecordDrop && entries.length < minimum) {
      throw new Error(
        `${sourceKey} record count dropped from ${version.previousRecordCount} to ${entries.length} (more than ${MAX_RECORD_DROP_RATIO * 100}%); refusing to activate. Re-run with allowRecordDrop if the shrink is genuine.`,
      );
    }
    const contentHash = await sha256(body);
    const sourceVersion = lastModified ?? contentHash.slice(0, 16);
    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      await ctx.runMutation(internal.watchlists._appendEntries, {
        versionId: version.versionId,
        sourceKey,
        entries: entries.slice(offset, offset + BATCH_SIZE),
        now: Date.now(),
      });
    }
    const activation: { activated: boolean; reason?: string } = await ctx.runMutation(internal.watchlists._activateVersion, {
      versionId: version.versionId,
      sourceKey,
      sourceUrl,
      sourceVersion,
      contentHash,
      recordCount: entries.length,
      completedAt: Date.now(),
      allowRecordDrop,
    });
    if (!activation.activated) throw new Error(activation.reason ?? `${sourceKey} version was not activated`);
    return { sourceKey, recordCount: entries.length, contentHash, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion failure";
    await ctx.runMutation(internal.watchlists._failVersion, {
      versionId: version.versionId,
      sourceKey,
      error: message.slice(0, 500),
      failedAt: Date.now(),
    });
    throw new Error(`${sourceKey} ingestion failed: ${message}`);
  }
}

// `allowRecordDrop` is an operator override for a genuine large delisting:
// `npx convex run watchlists:ingestOfac '{"allowRecordDrop": true}'`.
export const ingestOfac = internalAction({
  args: { allowRecordDrop: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    runIngestion(ctx, "OFAC_SDN", requireUrl("WATCHLIST_OFAC_SDN_URL", DEFAULT_OFAC_URL), args.allowRecordDrop ?? false),
});

export const ingestUn = internalAction({
  args: { allowRecordDrop: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    runIngestion(ctx, "UN_CONSOLIDATED", requireUrl("WATCHLIST_UN_CONSOLIDATED_URL"), args.allowRecordDrop ?? false),
});

async function activeVersionFor(ctx: MutationCtx, sourceKey: SourceKey) {
  return await ctx.db
    .query("watchlistVersions")
    .withIndex("by_source_and_status", (q) => q.eq("sourceKey", sourceKey).eq("status", "active"))
    .order("desc")
    .first();
}

export const _startVersion = internalMutation({
  args: {
    sourceKey: sourceKeyValidator,
    sourceUrl: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey)).unique();
    const sourceId = existing?._id ?? await ctx.db.insert("watchlistSources", {
      sourceKey: args.sourceKey,
      displayName: args.sourceKey === "OFAC_SDN" ? "OFAC Specially Designated Nationals" : "UN Security Council Consolidated List",
      sourceUrl: args.sourceUrl,
      cadence: "daily",
      enabled: true,
      updatedAt: args.startedAt,
    });
    if (existing) await ctx.db.patch(sourceId, { sourceUrl: args.sourceUrl, lastAttemptedAt: args.startedAt, lastError: undefined, updatedAt: args.startedAt });
    const versionId = await ctx.db.insert("watchlistVersions", {
      sourceKey: args.sourceKey,
      sourceUrl: args.sourceUrl,
      sourceVersion: `pending-${args.startedAt}`,
      contentHash: "pending",
      status: "pending",
      recordCount: 0,
      fetchedAt: args.startedAt,
    });
    const active = await activeVersionFor(ctx, args.sourceKey);
    return { versionId, previousRecordCount: active && active.recordCount > 0 ? active.recordCount : null };
  },
});

export const _appendEntries = internalMutation({
  args: { sourceKey: sourceKeyValidator, versionId: v.id("watchlistVersions"), entries: v.array(entryValidator), now: v.number() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    // Never write into a version that was already failed or garbage-collected.
    if (!version || version.status !== "pending") throw new Error("Watchlist version is no longer pending");
    for (const entry of args.entries) {
      await ctx.db.insert("watchlistEntries", {
        versionId: args.versionId,
        sourceKey: args.sourceKey,
        ...entry,
        isActive: true,
        firstSeenAt: args.now,
        lastSeenAt: args.now,
      });
    }
  },
});

export const _activateVersion = internalMutation({
  args: {
    versionId: v.id("watchlistVersions"),
    sourceKey: sourceKeyValidator,
    sourceUrl: v.string(),
    sourceVersion: v.string(),
    contentHash: v.string(),
    recordCount: v.number(),
    completedAt: v.number(),
    allowRecordDrop: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.status !== "pending") {
      return { activated: false, reason: `${args.sourceKey} version is no longer pending` };
    }
    const active = await ctx.db
      .query("watchlistVersions")
      .withIndex("by_source_and_status", (q) => q.eq("sourceKey", args.sourceKey).eq("status", "active"))
      .collect();
    // Re-checked here, transactionally, against the version actually active now.
    const previous = active.reduce((max, row) => Math.max(max, row.recordCount), 0);
    if (!args.allowRecordDrop && args.recordCount < minimumAcceptedCount(previous || null)) {
      return {
        activated: false,
        reason: `${args.sourceKey} record count dropped from ${previous} to ${args.recordCount} (more than ${MAX_RECORD_DROP_RATIO * 100}%); refusing to activate.`,
      };
    }
    for (const row of active) await ctx.db.patch(row._id, { status: "superseded", supersededAt: args.completedAt });
    await ctx.db.patch(args.versionId, { status: "active", sourceVersion: args.sourceVersion, contentHash: args.contentHash, recordCount: args.recordCount, activatedAt: args.completedAt });
    const source = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey)).unique();
    if (source) await ctx.db.patch(source._id, { currentVersionId: args.versionId, sourceUrl: args.sourceUrl, lastSuccessfulAt: args.completedAt, lastError: undefined, updatedAt: args.completedAt });
    return { activated: true };
  },
});

export const _failVersion = internalMutation({
  args: { versionId: v.id("watchlistVersions"), sourceKey: sourceKeyValidator, error: v.string(), failedAt: v.number() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    // Never demote a version that made it to active (or was already purged).
    if (version && version.status === "pending") {
      await ctx.db.patch(args.versionId, { status: "failed", failureReason: args.error });
    }
    const source = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey)).unique();
    if (source) await ctx.db.patch(source._id, { lastAttemptedAt: args.failedAt, lastError: args.error, updatedAt: args.failedAt });
  },
});

// Oldest purgeable version: failed ones immediately, superseded ones after
// the retention window.
async function nextPurgeableVersion(ctx: MutationCtx, now: number): Promise<Doc<"watchlistVersions"> | null> {
  const failed = await ctx.db
    .query("watchlistVersions")
    .withIndex("by_status_and_purgedAt", (q) => q.eq("status", "failed").eq("purgedAt", undefined))
    .first();
  if (failed) return failed;
  const superseded = await ctx.db
    .query("watchlistVersions")
    .withIndex("by_status_and_purgedAt", (q) => q.eq("status", "superseded").eq("purgedAt", undefined))
    .take(50);
  return (
    superseded.find((row) => now - (row.supersededAt ?? row.activatedAt ?? row.fetchedAt) >= SUPERSEDED_RETENTION_MS) ??
    null
  );
}

// Deletes the entries of superseded/failed watchlist versions in bounded
// batches, rescheduling itself until nothing is left (or the per-firing run
// budget is spent; the hourly cron picks up from there). Entries referenced by
// a flaggedEntities row are kept as audit evidence. The version document
// itself is kept (marked purgedAt) for the ingestion history.
export const purgeWatchlistVersions = internalMutation({
  args: {
    versionId: v.optional(v.id("watchlistVersions")),
    cursor: v.optional(v.string()),
    remainingRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const remainingRuns = args.remainingRuns ?? GC_MAX_CHAIN_RUNS;
    if (remainingRuns <= 0) return { done: false };

    if (!args.versionId) {
      // Crashed ingestion runs leave versions stuck in "pending".
      const pending = await ctx.db
        .query("watchlistVersions")
        .withIndex("by_status_and_purgedAt", (q) => q.eq("status", "pending").eq("purgedAt", undefined))
        .take(20);
      for (const row of pending) {
        if (now - row.fetchedAt > PENDING_ABANDON_MS) {
          await ctx.db.patch(row._id, { status: "failed", failureReason: "Ingestion abandoned before activation." });
        }
      }
    }

    let target = args.versionId ? await ctx.db.get(args.versionId) : null;
    let cursor = args.cursor ?? null;
    if (!target || (target.status !== "superseded" && target.status !== "failed") || target.purgedAt !== undefined) {
      target = await nextPurgeableVersion(ctx, now);
      cursor = null;
    }
    if (!target) return { done: true };

    const page = await ctx.db
      .query("watchlistEntries")
      .withIndex("by_version", (q) => q.eq("versionId", target._id))
      .paginate({ numItems: GC_ENTRY_BATCH, cursor });
    let deleted = 0;
    for (const entry of page.page) {
      const referenced = await ctx.db
        .query("flaggedEntities")
        .withIndex("by_watchlist_entry", (q) => q.eq("watchlistEntryId", entry._id))
        .first();
      if (referenced) continue;
      await ctx.db.delete(entry._id);
      deleted += 1;
    }

    if (page.isDone) {
      await ctx.db.patch(target._id, { purgedAt: now });
      await ctx.scheduler.runAfter(0, internal.watchlists.purgeWatchlistVersions, { remainingRuns: remainingRuns - 1 });
    } else {
      await ctx.scheduler.runAfter(0, internal.watchlists.purgeWatchlistVersions, {
        versionId: target._id,
        cursor: page.continueCursor,
        remainingRuns: remainingRuns - 1,
      });
    }
    return { done: false, versionId: target._id, deleted };
  },
});

/** Stable customer authorization boundary. */
export const currentAccess = query({
  args: {},
  returns: currentAccessResult,
  handler: async (ctx) => loadCurrentAccess(ctx),
});
