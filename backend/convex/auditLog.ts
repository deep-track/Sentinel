import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";

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
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst"]);

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
