import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { buildVerificationReference } from "./lib/crypto";
import { requireClientRole } from "./lib/rbac";

const deliveryMethod = v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("email"));

export const submit = mutation({
  args: { clientId: v.id("clients"), contact: v.string(), method: deliveryMethod },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);
    const contact = args.contact.trim();
    if (!contact) throw new ConvexError({ code: "invalid_argument", message: "A phone number or email is required." });
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    const now = Date.now();
    const verificationId = await ctx.db.insert("verifications", { clientId: args.clientId, type: "liveness", status: "queued", creditsUsed: 0, input: { contact, method: args.method }, reference: buildVerificationReference(), createdAt: now, updatedAt: now });
    const requestId = await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact, method: args.method, status: "pending", verificationId, createdAt: now, sentAt: now });
    return { requestId, verificationId };
  },
});

export const list = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const rows = await ctx.db.query("livenessRequests").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
});

export const status = query({
  args: { requestId: v.id("livenessRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    await requireClientRole(ctx, request.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    return request;
  },
});
