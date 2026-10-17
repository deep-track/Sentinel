import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { hitKey, subjectKeyFor, type ClearedHit } from "./lib/amlClearedMatches";

// False-positive memory (lib/amlClearedMatches.ts). recordClearedMatches is
// called when a review approves an AML screening; clearedHitsFor feeds the
// screening rules (aml._screeningRules); Settings → Screening rules lists
// them and can forget one.

const MAX_PER_SUBJECT = 200;
const LIST_LIMIT = 200;

// The customer an AML verification was about (null = name only).
export function subjectKeyOfVerification(verification: Pick<Doc<"verifications">, "input">): string | null {
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const monitoring = input.monitoring as { externalRef?: unknown } | undefined;
  return subjectKeyFor({ ...input, externalRef: input.externalRef ?? monitoring?.externalRef });
}

export async function recordClearedMatches(
  ctx: MutationCtx,
  params: { verification: Doc<"verifications">; reviewId: Id<"reviewQueue">; clearedBy: string; clearedByName?: string; reasonCode?: string },
): Promise<number> {
  const { verification } = params;
  if (verification.type !== "aml") return 0;
  const subjectKey = subjectKeyOfVerification(verification);
  if (!subjectKey) return 0;
  // The stored matches carry each list's own record id, which stays the same
  // across daily list refreshes (watchlist entry ids don't).
  type StoredMatch = { source: string; sourceRecordId: string; entityName: string; categories?: string[]; pepClass?: number; riskLevel: "critical" | "high" };
  const flagged = (((verification.result as { matches?: unknown } | null)?.matches ?? []) as StoredMatch[]).filter(
    (match) => match && typeof match.source === "string" && typeof match.sourceRecordId === "string",
  );
  if (flagged.length === 0) return 0;
  const existing = await ctx.db
    .query("amlClearedMatches")
    .withIndex("by_client_and_subject", (q) => q.eq("clientId", verification.clientId).eq("subjectKey", subjectKey))
    .take(MAX_PER_SUBJECT);
  const now = Date.now();
  const subjectName = String((verification.input as { subjectName?: unknown } | null)?.subjectName ?? verification.reference).slice(0, 300);
  let recorded = 0;
  for (const hit of flagged.slice(0, 100)) {
    const matchKey = hitKey(hit.source, hit.sourceRecordId);
    const fields = {
      subjectName,
      source: hit.source,
      sourceRecordId: hit.sourceRecordId,
      entityName: hit.entityName,
      categories: hit.categories ?? (hit.source === "ADVERSE_MEDIA" ? ["adverse_media"] : ["sanctions"]),
      ...(hit.pepClass ? { pepClass: hit.pepClass } : {}),
      riskLevel: hit.riskLevel,
      verificationId: verification._id,
      reviewId: params.reviewId,
      clearedBy: params.clearedBy,
      clearedByName: params.clearedByName,
      reasonCode: params.reasonCode,
      clearedAt: now,
    };
    const current = existing.find((row) => row.matchKey === matchKey);
    if (current) {
      await ctx.db.patch(current._id, { ...fields, revokedAt: undefined, revokedBy: undefined });
    } else {
      await ctx.db.insert("amlClearedMatches", { clientId: verification.clientId, subjectKey, matchKey, suppressedCount: 0, ...fields });
    }
    recorded += 1;
  }
  return recorded;
}

export async function clearedHitsFor(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">, subjectKey: string | null): Promise<ClearedHit[]> {
  if (!subjectKey) return [];
  const rows = await ctx.db
    .query("amlClearedMatches")
    .withIndex("by_client_and_subject", (q) => q.eq("clientId", clientId).eq("subjectKey", subjectKey))
    .take(MAX_PER_SUBJECT);
  return rows
    .filter((row) => row.revokedAt === undefined)
    .map((row) => ({
      key: row.matchKey,
      entityName: row.entityName,
      categories: row.categories,
      ...(row.pepClass ? { pepClass: row.pepClass } : {}),
      riskLevel: row.riskLevel,
      clearedAt: row.clearedAt,
      clearedByName: row.clearedByName,
      reasonCode: row.reasonCode,
    }));
}

// Counts how often a cleared hit kept a screening quiet.
export async function noteSuppressed(ctx: MutationCtx, clientId: Id<"clients">, subjectKey: string | null, keys: string[]) {
  if (!subjectKey || keys.length === 0) return;
  const rows = await ctx.db
    .query("amlClearedMatches")
    .withIndex("by_client_and_subject", (q) => q.eq("clientId", clientId).eq("subjectKey", subjectKey))
    .take(MAX_PER_SUBJECT);
  const now = Date.now();
  for (const row of rows) {
    if (keys.includes(row.matchKey) && row.revokedAt === undefined) {
      await ctx.db.patch(row._id, { suppressedCount: row.suppressedCount + 1, lastSuppressedAt: now });
    }
  }
}

export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "reviewer", "compliance_analyst", "viewer"]);
    const rows = await ctx.db
      .query("amlClearedMatches")
      .withIndex("by_client_and_cleared_at", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(LIST_LIMIT);
    return rows
      .filter((row) => row.revokedAt === undefined)
      .map((row) => ({
        _id: row._id,
        subjectName: row.subjectName,
        identifiedBy: row.subjectKey.startsWith("ref:") ? "customer reference" : row.subjectKey.includes("|id:") ? "ID number" : row.subjectKey.includes("|reg:") ? "registration number" : "date of birth",
        entityName: row.entityName,
        source: row.source,
        categories: row.categories,
        pepClass: row.pepClass ?? null,
        clearedByName: row.clearedByName ?? null,
        reasonCode: row.reasonCode ?? null,
        clearedAt: row.clearedAt,
        suppressedCount: row.suppressedCount,
        lastSuppressedAt: row.lastSuppressedAt ?? null,
        verificationId: row.verificationId,
      }));
  },
});

// Forgets a cleared hit: the next screening raises it again.
export const forget = mutation({
  args: { clearedId: v.id("amlClearedMatches") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.clearedId);
    if (!row) throw new ConvexError({ code: "not_found", message: "Cleared match not found." });
    const actor = await requireClientRole(ctx, row.clientId, ["client_admin", "reviewer"]);
    if (row.revokedAt !== undefined) return null;
    await ctx.db.patch(row._id, { revokedAt: Date.now(), revokedBy: actor.userId });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "aml.cleared_match_forgotten",
      targetType: "amlClearedMatch",
      targetId: row._id,
      clientId: row.clientId,
      metadata: { subjectName: row.subjectName, entityName: row.entityName, source: row.source },
    });
    return null;
  },
});
