import { ConvexError, v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { recordAudit } from "./auditLog";
import {
  allowedPageUrl,
  extractRiskEntries,
  FETCH_USER_AGENT,
  htmlToText,
  parseRiskCsv,
  RISK_LIST_KEYS,
  RISK_LIST_SOURCES,
  riskListSource,
  robotsAllows,
  type ExtractedRiskEntry,
  type RiskEntry,
  type RiskListKey,
} from "./lib/riskLists";

// Kenyan risk lists (Back Office -> Kenyan risk lists): PPRA debarment,
// CBK / CMA / IRA / SASRA / RBA enforcement, EACC, DCI wanted persons and
// Assets Recovery Agency forfeitures. Entries come from a publication
// DeepTrack uploads, one public page it points to (on the authority's own
// domain, only if its robots.txt allows Sentinel; never crawled), a CSV or
// by hand. What Claude extracts is approved by a person before it counts.
// Screening reads the active entries (loadRiskLists).

const internalApi: any = internal;
const sourceValidator = v.union(...RISK_LIST_KEYS.map((key) => v.literal(key)));
const MAX_LISTED = 500;
const MAX_SCREENED = 50_000;
const MAX_PAGE_BYTES = 15 * 1024 * 1024;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function cleanEntry(input: ExtractedRiskEntry) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 200) invalid("Enter the name.");
  if (!input.reason.trim()) invalid("Say why they are listed.");
  const date = (value: string | null | undefined, label: string) => {
    if (!value?.trim()) return undefined;
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value.trim())) invalid(`${label} must be YYYY-MM-DD.`);
    return value.trim();
  };
  return {
    name,
    aliases: input.aliases.map((alias) => alias.trim()).filter(Boolean).slice(0, 10),
    entityType: input.entityType,
    reason: input.reason.trim().slice(0, 500),
    action: input.action?.trim().slice(0, 200) || undefined,
    startDate: date(input.startDate, "Start date"),
    endDate: date(input.endDate, "End date"),
    reference: input.reference?.trim().slice(0, 100) || undefined,
  };
}

export const list = query({
  args: { sourceKey: v.optional(sourceValidator), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const rows = args.sourceKey
      ? await ctx.db.query("riskListEntries").withIndex("by_source_and_active", (q) => q.eq("sourceKey", args.sourceKey!).eq("active", true)).order("desc").take(5000)
      : await ctx.db.query("riskListEntries").withIndex("by_active", (q) => q.eq("active", true)).order("desc").take(5000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => [row.name, row.reason, row.reference, ...row.aliases].some((value) => value?.toLowerCase().includes(needle))) : rows;
    const all = args.sourceKey ? await ctx.db.query("riskListEntries").withIndex("by_active", (q) => q.eq("active", true)).take(MAX_SCREENED) : rows;
    const imports = await ctx.db.query("riskListImports").withIndex("by_created_at").order("desc").take(20);
    return {
      sources: RISK_LIST_SOURCES.map((source) => ({ ...source, count: all.filter((row) => row.sourceKey === source.key).length })),
      entries: filtered.slice(0, MAX_LISTED),
      imports: imports.map((row) => ({ _id: row._id, sourceKey: row.sourceKey, label: row.label, url: row.url ?? null, status: row.status, error: row.error ?? null, createdAt: row.createdAt, proposals: row.status === "ready" ? row.proposals : null, approvedCount: row.approvedCount ?? null })),
    };
  },
});

export const add = mutation({
  args: {
    sourceKey: sourceValidator,
    entry: v.object({
      name: v.string(),
      aliases: v.optional(v.array(v.string())),
      entityType: v.union(v.literal("individual"), v.literal("entity")),
      reason: v.string(),
      action: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      reference: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const now = Date.now();
    const entry = cleanEntry({ ...args.entry, aliases: args.entry.aliases ?? [], action: args.entry.action ?? null, startDate: args.entry.startDate ?? null, endDate: args.entry.endDate ?? null, reference: args.entry.reference ?? null });
    const id = await ctx.db.insert("riskListEntries", { sourceKey: args.sourceKey, ...entry, origin: "manual", active: true, addedBy: actorId, createdAt: now, updatedAt: now });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_list.added", targetType: "riskListEntry", targetId: id, metadata: { sourceKey: args.sourceKey, name: entry.name } });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("riskListEntries") },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const row = await ctx.db.get(args.id);
    if (!row) throw new ConvexError({ code: "not_found", message: "Entry not found." });
    await ctx.db.patch(row._id, { active: false, updatedAt: Date.now() });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_list.removed", targetType: "riskListEntry", targetId: row._id, metadata: { sourceKey: row.sourceKey, name: row.name } });
    return null;
  },
});

export const importCsv = mutation({
  args: { sourceKey: sourceValidator, csv: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    if (args.csv.length > 5_000_000) invalid("The file is larger than 5 MB; split it.");
    const { rows, errors } = parseRiskCsv(args.csv);
    if (!rows.length) invalid(errors.join(" ") || "No rows found.");
    const now = Date.now();
    for (const row of rows) {
      await ctx.db.insert("riskListEntries", { sourceKey: args.sourceKey, ...cleanEntry(row), origin: "import", originRef: args.label.slice(0, 120) || undefined, active: true, addedBy: actorId, createdAt: now, updatedAt: now });
    }
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_list.imported", targetType: "riskListEntry", targetId: "import", metadata: { sourceKey: args.sourceKey, label: args.label, added: rows.length, errors: errors.length } });
    return { added: rows.length, errors };
  },
});

// ── Reading a publication ──────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireInternalAdmin(ctx, "write");
    return await ctx.storage.generateUploadUrl();
  },
});

export const read = mutation({
  args: { sourceKey: sourceValidator, label: v.string(), storageId: v.optional(v.id("_storage")), text: v.optional(v.string()), url: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const label = args.label.trim().slice(0, 160);
    if (!label) invalid("Name the publication.");
    if (!args.storageId && !args.text?.trim() && !args.url?.trim()) invalid("Upload a PDF, paste text or give the page's address.");
    if (args.url && !allowedPageUrl(args.sourceKey, args.url)) {
      invalid(`The page must be an https address on ${riskListSource(args.sourceKey)?.domains.join(" or ") || "the authority's site"}.`);
    }
    if (args.text && args.text.length > 800_000) invalid("The text is too long; split it.");
    const importId = await ctx.db.insert("riskListImports", {
      sourceKey: args.sourceKey,
      label,
      ...(args.url ? { url: args.url.trim() } : {}),
      ...(args.storageId ? { storageId: args.storageId } : {}),
      status: "reading",
      uploadedBy: actorId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internalApi.riskLists._extract, { importId, ...(args.text ? { text: args.text } : {}) });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_list.publication_read", targetType: "riskListImport", targetId: importId, metadata: { sourceKey: args.sourceKey, label, url: args.url ?? null } });
    return importId;
  },
});

export const _import = internalQuery({
  args: { importId: v.id("riskListImports") },
  handler: async (ctx, args) => await ctx.db.get(args.importId),
});

export const _setImport = internalMutation({
  args: { importId: v.id("riskListImports"), status: v.union(v.literal("ready"), v.literal("failed")), proposals: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.importId, { status: args.status, ...(args.proposals ? { proposals: args.proposals } : {}), ...(args.error ? { error: args.error } : {}) });
  },
});

// One page, once, if robots.txt allows it: never a crawl.
async function fetchPage(url: URL, sourceKey: RiskListKey): Promise<{ pdfBase64?: string; text?: string }> {
  const robotsResponse = await fetch(`${url.origin}/robots.txt`, { headers: { "User-Agent": FETCH_USER_AGENT } }).catch(() => null);
  const robots = robotsResponse?.ok ? await robotsResponse.text() : "";
  if (!robotsAllows(robots, url.pathname + url.search)) throw new Error(`${url.hostname}'s robots.txt doesn't allow fetching this page. Download it yourself and upload it.`);
  const response = await fetch(url.toString(), { headers: { "User-Agent": FETCH_USER_AGENT, Accept: "text/html,application/pdf" }, redirect: "follow" });
  if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);
  // A redirect may only stay on the authority's own site.
  if (response.url && !allowedPageUrl(sourceKey, response.url)) throw new Error("The page redirected off the authority's site.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error("The page is larger than 15 MB.");
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return { pdfBase64: Buffer.from(bytes).toString("base64") };
  return { text: htmlToText(new TextDecoder().decode(bytes)) };
}

export const _extract = internalAction({
  args: { importId: v.id("riskListImports"), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row: Doc<"riskListImports"> | null = await ctx.runQuery(internalApi.riskLists._import, { importId: args.importId });
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!row) return;
    const fail = (error: string) => ctx.runMutation(internalApi.riskLists._setImport, { importId: args.importId, status: "failed", error: error.slice(0, 300) });
    if (!apiKey) return void (await fail("AI reading isn't configured."));
    try {
      let document: { pdfBase64?: string; text?: string } = { text: args.text };
      if (row.storageId) {
        const blob = await ctx.storage.get(row.storageId);
        if (!blob) throw new Error("The uploaded file is missing.");
        if (blob.size > 30 * 1024 * 1024) throw new Error("The PDF is larger than 30 MB; split it.");
        document = { pdfBase64: Buffer.from(await blob.arrayBuffer()).toString("base64") };
      } else if (row.url) {
        const url = allowedPageUrl(row.sourceKey, row.url);
        if (!url) throw new Error("The address isn't on the authority's site.");
        document = await fetchPage(url, row.sourceKey);
      }
      const entries = await extractRiskEntries(new Anthropic({ apiKey }), row.sourceKey, document, row.label);
      await ctx.runMutation(internalApi.riskLists._setImport, { importId: args.importId, status: "ready", proposals: entries });
    } catch (error) {
      await fail(error instanceof Error ? error.message : "The publication couldn't be read.");
    }
  },
});

export const approve = mutation({
  args: { importId: v.id("riskListImports"), indexes: v.array(v.number()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const row = await ctx.db.get(args.importId);
    if (!row || row.status !== "ready") invalid("This publication isn't waiting for approval.");
    const proposals = (row.proposals ?? []) as ExtractedRiskEntry[];
    const now = Date.now();
    let added = 0;
    for (const index of [...new Set(args.indexes)]) {
      const item = proposals[index];
      if (!item) continue;
      await ctx.db.insert("riskListEntries", {
        sourceKey: row.sourceKey,
        ...cleanEntry(item),
        origin: row.url ? "page" : "upload",
        originRef: [row.label, row.url].filter(Boolean).join(" - ").slice(0, 300),
        active: true,
        addedBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
      added += 1;
    }
    await ctx.db.patch(row._id, { status: "approved", approvedAt: now, approvedCount: added });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "risk_list.approved", targetType: "riskListImport", targetId: row._id, metadata: { sourceKey: row.sourceKey, label: row.label, added } });
    return { added };
  },
});

// ── Screening ──────────────────────────────────────────────────────────────

export const _activeEntries = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("riskListEntries").withIndex("by_active", (q) => q.eq("active", true)).paginate({ cursor: args.cursor ?? null, numItems: 2000 });
    return {
      entries: page.page.map(
        (row): RiskEntry => ({
          _id: row._id,
          sourceKey: row.sourceKey as RiskListKey,
          name: row.name,
          aliases: row.aliases,
          entityType: row.entityType,
          reason: row.reason,
          action: row.action ?? null,
          startDate: row.startDate ?? null,
          endDate: row.endDate ?? null,
          reference: row.reference ?? null,
        }),
      ),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export async function loadRiskLists(ctx: { runQuery: any }): Promise<RiskEntry[]> {
  const entries: RiskEntry[] = [];
  let cursor: string | undefined;
  while (entries.length < MAX_SCREENED) {
    const page: { entries: RiskEntry[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internalApi.riskLists._activeEntries, { cursor });
    entries.push(...page.entries);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return entries;
}
