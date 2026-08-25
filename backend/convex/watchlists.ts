import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isInternalAdmin } from "./lib/rbac";

const SOURCE_KEYS = ["OFAC_SDN", "UN_CONSOLIDATED"] as const;
type SourceKey = (typeof SOURCE_KEYS)[number];
type NormalizedEntry = {
  sourceRecordId: string;
  entityType: "individual" | "entity" | "unknown";
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  programs: string[];
  identifiers?: unknown;
};

const DEFAULT_OFAC_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const BATCH_SIZE = 250;

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

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function tagValue(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, " ")) : undefined;
}

function tagValues(block: string, tag: string): string[] {
  return Array.from(block.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")))
    .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, " ")))
    .filter(Boolean);
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nameFromParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function parseOfac(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<sdnEntry\b[\s\S]*?<\/sdnEntry>/gi)).map((m) => m[0]);
  if (blocks.length === 0) throw new Error("OFAC response did not contain sdnEntry records");
  return blocks.map((block, index) => {
    const first = tagValue(block, "firstName");
    const last = tagValue(block, "lastName");
    const primaryName = nameFromParts([first, last]);
    const aliases = Array.from(block.matchAll(/<aka\b[\s\S]*?<\/aka>/gi))
      .map((match) => nameFromParts([tagValue(match[0], "firstName"), tagValue(match[0], "lastName")]))
      .filter(Boolean);
    const programs = tagValues(block, "program");
    const countries = unique([...tagValues(block, "country"), ...tagValues(block, "nationality")]);
    const sourceRecordId = tagValue(block, "uid") ?? `ofac-${index + 1}`;
    const names = unique([primaryName, ...aliases]);
    return {
      sourceRecordId,
      entityType: tagValue(block, "sdnType")?.toLowerCase() === "individual" ? "individual" : "entity",
      primaryName: primaryName || sourceRecordId,
      aliases,
      normalizedNames: names.map(normalizeName),
      countries,
      programs,
      identifiers: { uid: sourceRecordId },
    };
  });
}

function parseUn(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<(INDIVIDUAL|ENTITY)\b[\s\S]*?<\/\1>/gi)).map((m) => ({ block: m[0], type: m[1].toUpperCase() }));
  if (blocks.length === 0) throw new Error("UN response did not contain INDIVIDUAL or ENTITY records");
  return blocks.map(({ block, type }, index) => {
    const primaryName = nameFromParts([
      tagValue(block, "FIRST_NAME"),
      tagValue(block, "SECOND_NAME"),
      tagValue(block, "THIRD_NAME"),
      tagValue(block, "FOURTH_NAME"),
      tagValue(block, "NAME"),
    ]);
    const aliases = Array.from(block.matchAll(/<INDIVIDUAL_ALIAS\b[\s\S]*?<\/INDIVIDUAL_ALIAS>/gi))
      .map((match) => nameFromParts([tagValue(match[0], "ALIAS_NAME"), tagValue(match[0], "QUALITY")]))
      .filter(Boolean);
    const sourceRecordId = tagValue(block, "DATAID") ?? tagValue(block, "ENTITY_ID") ?? `un-${index + 1}`;
    const unListType = tagValue(block, "UN_LIST_TYPE");
    const programs = unique([...(unListType ? [unListType] : []), ...tagValues(block, "REFERENCE_NUMBER")]);
    const countries = unique([...tagValues(block, "NATIONALITY"), ...tagValues(block, "COUNTRY"), ...tagValues(block, "LOCATION")]);
    const names = unique([primaryName, ...aliases]);
    return {
      sourceRecordId,
      entityType: type === "INDIVIDUAL" ? "individual" : "entity",
      primaryName: primaryName || sourceRecordId,
      aliases,
      normalizedNames: names.map(normalizeName),
      countries,
      programs,
      identifiers: { dataId: sourceRecordId },
    };
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSource(sourceKey: SourceKey, body: string): NormalizedEntry[] {
  return sourceKey === "OFAC_SDN" ? parseOfac(body) : parseUn(body);
}

async function runIngestion(ctx: any, sourceKey: SourceKey, sourceUrl: string) {
  const startedAt = Date.now();
  const version = (await ctx.runMutation(internal.watchlists._startVersion, {
    sourceKey,
    sourceUrl,
    startedAt,
  })) as { versionId: Id<"watchlistVersions"> };
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Deeptrack-Sentinel-Watchlist-Ingestion/1.0" },
    });
    if (!response.ok) throw new Error(`${sourceKey} source returned HTTP ${response.status}`);
    const body = await response.text();
    if (body.length < 256) throw new Error(`${sourceKey} source response was unexpectedly small`);
    const entries = parseSource(sourceKey, body);
    if (entries.length === 0) throw new Error(`${sourceKey} source produced zero records`);
    const contentHash = await sha256(body);
    const sourceVersion = response.headers.get("last-modified") ?? contentHash.slice(0, 16);
    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      await ctx.runMutation(internal.watchlists._appendEntries, {
        versionId: version.versionId,
        sourceKey,
        entries: entries.slice(offset, offset + BATCH_SIZE),
        now: Date.now(),
      });
    }
    await ctx.runMutation(internal.watchlists._activateVersion, {
      versionId: version.versionId,
      sourceKey,
      sourceUrl,
      sourceVersion,
      contentHash,
      recordCount: entries.length,
      completedAt: Date.now(),
    });
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

export const ingestOfac = internalAction({
  args: {},
  handler: async (ctx) => runIngestion(ctx, "OFAC_SDN", requireUrl("WATCHLIST_OFAC_SDN_URL", DEFAULT_OFAC_URL)),
});

export const ingestUn = internalAction({
  args: {},
  handler: async (ctx) => runIngestion(ctx, "UN_CONSOLIDATED", requireUrl("WATCHLIST_UN_CONSOLIDATED_URL")),
});

export const _startVersion = internalMutation({
  args: {
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
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
    return { versionId };
  },
});

export const _appendEntries = internalMutation({
  args: { sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")), versionId: v.id("watchlistVersions"), entries: v.array(entryValidator), now: v.number() },
  handler: async (ctx, args) => {
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
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
    sourceUrl: v.string(),
    sourceVersion: v.string(),
    contentHash: v.string(),
    recordCount: v.number(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const active = await ctx.db.query("watchlistVersions").withIndex("by_source_and_status", (q) => q.eq("sourceKey", args.sourceKey).eq("status", "active")).collect();
    for (const version of active) await ctx.db.patch(version._id, { status: "superseded" });
    await ctx.db.patch(args.versionId, { status: "active", sourceVersion: args.sourceVersion, contentHash: args.contentHash, recordCount: args.recordCount, activatedAt: args.completedAt });
    const source = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey)).unique();
    if (source) await ctx.db.patch(source._id, { currentVersionId: args.versionId, sourceUrl: args.sourceUrl, lastSuccessfulAt: args.completedAt, lastError: undefined, updatedAt: args.completedAt });
  },
});

export const _failVersion = internalMutation({
  args: { versionId: v.id("watchlistVersions"), sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")), error: v.string(), failedAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.versionId, { status: "failed", failureReason: args.error });
    const source = await ctx.db.query("watchlistSources").withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey)).unique();
    if (source) await ctx.db.patch(source._id, { lastAttemptedAt: args.failedAt, lastError: args.error, updatedAt: args.failedAt });
  },
});

const customerMembership = v.object({
  clientId: v.id("clients"),
  clientName: v.string(),
  clientStatus: v.union(
    v.literal("active"),
    v.literal("suspended"),
    v.literal("trial_expired"),
  ),
  role: v.union(
    v.literal("client_admin"),
    v.literal("compliance_analyst"),
    v.literal("developer"),
    v.literal("viewer"),
  ),
});

type ClientRole =
  | "client_admin"
  | "compliance_analyst"
  | "developer"
  | "viewer";

function normalizeClientRole(value: unknown): ClientRole | null {
  switch (String(value)) {
    case "client_admin":
    case "compliance_analyst":
    case "developer":
    case "viewer":
      return value as ClientRole;
    case "admin":
    case "administrator":
      return "client_admin";
    case "analyst":
      return "compliance_analyst";
    case "member":
      return "viewer";
    default:
      return null;
  }
}

/** Stable customer authorization boundary. */
export const currentAccess = query({
  args: {},
  returns: v.object({
    authorized: v.boolean(),
    memberships: v.array(customerMembership),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { authorized: false, memberships: [] };

    // Internal administrators have product-wide access and do not need a
    // customer membership. Regular users remain fail-closed below.
    if (await isInternalAdmin(ctx)) {
      return { authorized: true, memberships: [] };
    }

    try {
      const rows = await ctx.db
        .query("clientMembers")
        .withIndex("by_user", (q) => q.eq("userId", identity.subject))
        .collect();

      const memberships = (
        await Promise.all(
          rows
            .filter((row) => row.isActive)
            .map(async (row) => {
              const role = normalizeClientRole(row.role);
              if (!role) return null;

              const client = await ctx.db.get(row.clientId);
              if (!client || client.status !== "active") return null;

              return {
                clientId: client._id,
                clientName: client.name,
                clientStatus: client.status,
                role,
              };
            }),
        )
      ).filter((row): row is NonNullable<typeof row> => row !== null);

      return { authorized: memberships.length > 0, memberships };
    } catch (error) {
      console.error("[watchlists.currentAccess] denied due to read failure", error);
      return { authorized: false, memberships: [] };
    }
  },
});
