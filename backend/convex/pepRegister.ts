import { ConvexError, v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireInternalAdmin, requireInternalUser } from "./lib/rbac";
import { recordAudit } from "./auditLog";
import { extractGazetteAppointments, parsePepCsv, PEP_LEVEL_CLASS, PEP_LEVELS, type PepEntry, type PepLevel } from "./lib/kenyaPep";

// The Kenyan PEP register (Back Office -> PEP register). DeepTrack adds
// office holders three ways:
//  - Kenya Gazette: upload an issue (PDF or text) obtained from the
//    Government Printer or under Kenya Law's terms; Claude lists its
//    appointments, a person checks them and approves (nothing is added
//    without approval). Kenya Law prohibits scraping, so Sentinel never
//    downloads the Gazette itself.
//  - CSV import (county officials, MCAs, boards, relatives and associates);
//  - one by one.
// Screening reads the active entries (activeForScreening).

const internalApi: any = internal;
const levelValidator = v.union(...PEP_LEVELS.map((level) => v.literal(level)));
const MAX_LISTED = 500;
const MAX_SCREENED = 50_000;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

const entryInput = v.object({
  fullName: v.string(),
  aliases: v.optional(v.array(v.string())),
  position: v.string(),
  organisation: v.optional(v.string()),
  level: levelValidator,
  county: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  relatedTo: v.optional(v.string()),
});

function cleanEntry(input: { fullName: string; aliases?: string[]; position: string; organisation?: string | null; level: PepLevel; county?: string | null; startDate?: string | null; endDate?: string | null; birthDate?: string | null; relatedTo?: string | null }) {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const position = input.position.trim();
  if (fullName.length < 3 || fullName.length > 160) invalid("Enter the person's full name.");
  if (!position || position.length > 200) invalid("Enter the position.");
  const date = (value: string | null | undefined, label: string) => {
    if (!value?.trim()) return undefined;
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value.trim())) invalid(`${label} must be YYYY, YYYY-MM or YYYY-MM-DD.`);
    return value.trim();
  };
  const text = (value: string | null | undefined, max: number) => value?.trim().slice(0, max) || undefined;
  if (input.level === "family_associate" && !input.relatedTo?.trim()) invalid("Say which PEP this person is related to, and how.");
  return {
    fullName,
    aliases: (input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean).slice(0, 10),
    position: position.slice(0, 200),
    organisation: text(input.organisation, 200),
    level: input.level,
    county: text(input.county, 60),
    startDate: date(input.startDate, "Start date"),
    endDate: date(input.endDate, "End date"),
    birthDate: date(input.birthDate, "Date of birth"),
    relatedTo: text(input.relatedTo, 200),
  };
}

export const list = query({
  args: { search: v.optional(v.string()), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const rows = args.includeInactive
      ? await ctx.db.query("pepRegister").order("desc").take(5000)
      : await ctx.db.query("pepRegister").withIndex("by_active", (q) => q.eq("active", true)).order("desc").take(5000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => [row.fullName, row.position, row.organisation, row.county, ...row.aliases].some((value) => value?.toLowerCase().includes(needle))) : rows;
    const counts = { total: rows.length, byLevel: Object.fromEntries(PEP_LEVELS.map((level) => [level, rows.filter((row) => row.level === level).length])) };
    const imports = await ctx.db.query("gazetteImports").withIndex("by_created_at").order("desc").take(20);
    return {
      entries: filtered.slice(0, MAX_LISTED).map((row) => ({ ...row, pepClass: PEP_LEVEL_CLASS[row.level] })),
      counts,
      imports: imports.map((row) => ({ _id: row._id, label: row.label, status: row.status, error: row.error ?? null, createdAt: row.createdAt, proposals: row.status === "ready" ? row.proposals : null, approvedCount: row.approvedCount ?? null })),
    };
  },
});

export const add = mutation({
  args: { entry: entryInput },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const now = Date.now();
    const id = await ctx.db.insert("pepRegister", { ...cleanEntry(args.entry), source: "manual", active: true, addedBy: actorId, createdAt: now, updatedAt: now });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "pep_register.added", targetType: "pepRegister", targetId: id, metadata: { name: args.entry.fullName, position: args.entry.position } });
    return id;
  },
});

export const setActive = mutation({
  args: { id: v.id("pepRegister"), active: v.boolean() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const row = await ctx.db.get(args.id);
    if (!row) throw new ConvexError({ code: "not_found", message: "Entry not found." });
    await ctx.db.patch(row._id, { active: args.active, updatedAt: Date.now() });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: args.active ? "pep_register.restored" : "pep_register.removed", targetType: "pepRegister", targetId: row._id, metadata: { name: row.fullName } });
    return null;
  },
});

export const importCsv = mutation({
  args: { csv: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    if (args.csv.length > 5_000_000) invalid("The file is larger than 5 MB; split it.");
    const { rows, errors } = parsePepCsv(args.csv);
    if (errors.length && !rows.length) invalid(errors.join(" "));
    const now = Date.now();
    let added = 0;
    for (const row of rows) {
      await ctx.db.insert("pepRegister", { ...cleanEntry(row), source: "import", sourceRef: args.label.trim().slice(0, 120) || undefined, active: true, addedBy: actorId, createdAt: now, updatedAt: now });
      added += 1;
    }
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "pep_register.imported", targetType: "pepRegister", targetId: "import", metadata: { label: args.label, added, errors: errors.length } });
    return { added, errors };
  },
});

// ── Kenya Gazette ──────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireInternalAdmin(ctx, "write");
    return await ctx.storage.generateUploadUrl();
  },
});

export const readGazette = mutation({
  args: { label: v.string(), storageId: v.optional(v.id("_storage")), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const label = args.label.trim().slice(0, 120);
    if (!label) invalid("Name the issue, e.g. \"Kenya Gazette Vol. CXXVIII No. 181, 15 Oct 2026\".");
    if (!args.storageId && !args.text?.trim()) invalid("Upload the issue's PDF or paste its text.");
    if (args.text && args.text.length > 800_000) invalid("The text is too long; split the issue.");
    const importId = await ctx.db.insert("gazetteImports", { label, ...(args.storageId ? { storageId: args.storageId } : {}), status: "reading", uploadedBy: actorId, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internalApi.pepRegister._extract, { importId, ...(args.text ? { text: args.text } : {}) });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "pep_register.gazette_uploaded", targetType: "gazetteImport", targetId: importId, metadata: { label } });
    return importId;
  },
});

export const _import = internalQuery({
  args: { importId: v.id("gazetteImports") },
  handler: async (ctx, args) => await ctx.db.get(args.importId),
});

export const _setImport = internalMutation({
  args: { importId: v.id("gazetteImports"), status: v.union(v.literal("ready"), v.literal("failed")), proposals: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.importId, { status: args.status, ...(args.proposals ? { proposals: args.proposals } : {}), ...(args.error ? { error: args.error } : {}) });
  },
});

export const _extract = internalAction({
  args: { importId: v.id("gazetteImports"), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row: Doc<"gazetteImports"> | null = await ctx.runQuery(internalApi.pepRegister._import, { importId: args.importId });
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!row) return;
    if (!apiKey) return void (await ctx.runMutation(internalApi.pepRegister._setImport, { importId: args.importId, status: "failed", error: "AI reading isn't configured." }));
    try {
      let pdfBase64: string | undefined;
      if (row.storageId) {
        const blob = await ctx.storage.get(row.storageId);
        if (!blob) throw new Error("The uploaded file is missing.");
        if (blob.size > 30 * 1024 * 1024) throw new Error("The PDF is larger than 30 MB; split it.");
        pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      }
      const appointments = await extractGazetteAppointments(new Anthropic({ apiKey }), { pdfBase64, text: args.text }, row.label);
      await ctx.runMutation(internalApi.pepRegister._setImport, { importId: args.importId, status: "ready", proposals: appointments });
    } catch (error) {
      await ctx.runMutation(internalApi.pepRegister._setImport, { importId: args.importId, status: "failed", error: (error instanceof Error ? error.message : "The issue couldn't be read.").slice(0, 300) });
    }
  },
});

// Adds the appointments a person approved; revocations end the matching
// current entries instead.
export const approveGazette = mutation({
  args: { importId: v.id("gazetteImports"), indexes: v.array(v.number()) },
  handler: async (ctx, args) => {
    const actorId = await requireInternalAdmin(ctx, "write");
    const row = await ctx.db.get(args.importId);
    if (!row || row.status !== "ready") invalid("This issue isn't waiting for approval.");
    const proposals = (row.proposals ?? []) as Array<{ fullName: string; position: string; organisation: string | null; level: PepLevel; county: string | null; effectiveDate: string | null; endsAppointment: boolean; gazetteNotice: string | null }>;
    const now = Date.now();
    let added = 0;
    let ended = 0;
    for (const index of [...new Set(args.indexes)]) {
      const item = proposals[index];
      if (!item) continue;
      const sourceRef = [row.label, item.gazetteNotice].filter(Boolean).join(", ").slice(0, 200);
      if (item.endsAppointment) {
        const current = (await ctx.db.query("pepRegister").withIndex("by_full_name", (q) => q.eq("fullName", item.fullName)).take(20)).filter((entry) => entry.active && !entry.endDate && entry.position.toLowerCase() === item.position.toLowerCase());
        for (const entry of current) {
          await ctx.db.patch(entry._id, { endDate: item.effectiveDate ?? new Date(now).toISOString().slice(0, 10), updatedAt: now });
          ended += 1;
        }
        if (current.length) continue;
      }
      const entry = cleanEntry({ ...item, startDate: item.endsAppointment ? null : item.effectiveDate, endDate: item.endsAppointment ? item.effectiveDate ?? new Date(now).toISOString().slice(0, 10) : null });
      await ctx.db.insert("pepRegister", { ...entry, source: "gazette", sourceRef, active: true, addedBy: actorId, createdAt: now, updatedAt: now });
      added += 1;
    }
    await ctx.db.patch(row._id, { status: "approved", approvedAt: now, approvedCount: added + ended });
    await recordAudit(ctx, { actorId, actorType: "internal_admin", action: "pep_register.gazette_approved", targetType: "gazetteImport", targetId: row._id, metadata: { label: row.label, added, ended } });
    return { added, ended };
  },
});

// ── Screening ──────────────────────────────────────────────────────────────

export const _activeEntries = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("pepRegister").withIndex("by_active", (q) => q.eq("active", true)).paginate({ cursor: args.cursor ?? null, numItems: 2000 });
    return {
      entries: page.page.map(
        (row): PepEntry => ({
          _id: row._id,
          fullName: row.fullName,
          aliases: row.aliases,
          position: row.position,
          organisation: row.organisation ?? null,
          level: row.level,
          county: row.county ?? null,
          startDate: row.startDate ?? null,
          endDate: row.endDate ?? null,
          birthDate: row.birthDate ?? null,
          relatedTo: row.relatedTo ?? null,
        }),
      ),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Every active register entry, for one screening batch.
export async function loadPepRegister(ctx: { runQuery: any }): Promise<PepEntry[]> {
  const entries: PepEntry[] = [];
  let cursor: string | undefined;
  while (entries.length < MAX_SCREENED) {
    const page: { entries: PepEntry[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internalApi.pepRegister._activeEntries, { cursor });
    entries.push(...page.entries);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return entries;
}

