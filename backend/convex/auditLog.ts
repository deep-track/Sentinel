import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { profileNames } from "./userProfiles";

export const auditActorType = v.union(
  v.literal("internal_admin"),
  v.literal("reviewer"),
  v.literal("client_api_key"),
  v.literal("client_user"),
  v.literal("system"),
);

export type AuditActorType =
  | "internal_admin"
  | "reviewer"
  | "client_api_key"
  | "client_user"
  | "system";

export type AuditEntry = {
  actorId: string;
  actorType: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  clientId?: Id<"clients">;
  ipAddress?: string;
  metadata?: unknown;
};

// Writes an audit row inside the caller's transaction, so the audit entry
// commits (or rolls back) together with the change it describes.
export async function recordAudit(ctx: MutationCtx, entry: AuditEntry) {
  await ctx.db.insert("auditLog", { ...entry, timestamp: Date.now() });
}

// Maps the result of requireClientRole to an audit actor type.
export function actorTypeForClientRole(role: string): AuditActorType {
  return role === "internal_admin" ? "internal_admin" : "client_user";
}

export const _log = internalMutation({
  args: {
    actorId: v.string(),
    actorType: auditActorType,
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    clientId: v.optional(v.id("clients")),
    ipAddress: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await recordAudit(ctx, args);
  },
});

// Settings → Audit log: the client's audit trail, newest first, with
// people's names. `area` narrows it to one kind of event. Auditors
// (viewers) can read it too.
export const AUDIT_AREAS: Record<string, string[]> = {
  team: ["team.", "membership."],
  reviews: ["review."],
  settings: ["settings.", "webhook.", "api_key."],
  checks: ["verification.", "aml.", "document."],
};

export const listForClient = query({
  args: {
    clientId: v.id("clients"),
    area: v.optional(v.union(v.literal("team"), v.literal("reviews"), v.literal("settings"), v.literal("checks"))),
    startTimestamp: v.optional(v.number()),
    endTimestamp: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer", "viewer"]);
    const prefixes = args.area ? AUDIT_AREAS[args.area] : null;
    const page = await ctx.db
      .query("auditLog")
      .withIndex("by_client_and_timestamp", (q) => {
        const byClient = q.eq("clientId", args.clientId);
        if (args.startTimestamp !== undefined && args.endTimestamp !== undefined) {
          return byClient.gte("timestamp", args.startTimestamp).lte("timestamp", args.endTimestamp);
        }
        if (args.startTimestamp !== undefined) return byClient.gte("timestamp", args.startTimestamp);
        if (args.endTimestamp !== undefined) return byClient.lte("timestamp", args.endTimestamp);
        return byClient;
      })
      .order("desc")
      .paginate(args.paginationOpts);
    const rows = prefixes ? page.page.filter((row) => prefixes.some((prefix) => row.action.startsWith(prefix))) : page.page;
    const names = await profileNames(ctx, rows.filter((row) => row.actorType === "client_user" || row.actorType === "internal_admin" || row.actorType === "reviewer").map((row) => row.actorId));
    const keyIds = [...new Set(rows.filter((row) => row.actorType === "client_api_key").map((row) => row.actorId))];
    const keys = await Promise.all(keyIds.map((id) => ctx.db.normalizeId("apiKeys", id)).map((id) => (id ? ctx.db.get(id) : null)));
    const keyNames = new Map(keys.filter((key) => key !== null).map((key) => [key!._id as string, key!.label ?? `${key!.environment} key ${key!.prefix}`]));
    return {
      ...page,
      page: rows.map((row) => ({
        _id: row._id,
        timestamp: row.timestamp,
        action: row.action,
        actorType: row.actorType,
        actorName:
          row.actorType === "system"
            ? "Sentinel"
            : row.actorType === "client_api_key"
              ? `API: ${keyNames.get(row.actorId) ?? "key"}`
              : names.get(row.actorId) ?? (row.actorType === "internal_admin" || row.actorType === "reviewer" ? "DeepTrack" : "Team member"),
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata ?? null,
      })),
    };
  },
});

// Clients export a full audit trail of their verification history for any
// given period. Paginated (newest first) so large tenants never exceed the
// query read limits; callers loop on `continueCursor` until `isDone`.
export const exportForClient = query({
  args: {
    clientId: v.id("clients"),
    startTimestamp: v.optional(v.number()),
    endTimestamp: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "reviewer"]);

    return await ctx.db
      .query("auditLog")
      .withIndex("by_client_and_timestamp", (q) => {
        const byClient = q.eq("clientId", args.clientId);
        if (args.startTimestamp !== undefined && args.endTimestamp !== undefined) {
          return byClient.gte("timestamp", args.startTimestamp).lte("timestamp", args.endTimestamp);
        }
        if (args.startTimestamp !== undefined) return byClient.gte("timestamp", args.startTimestamp);
        if (args.endTimestamp !== undefined) return byClient.lte("timestamp", args.endTimestamp);
        return byClient;
      })
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
