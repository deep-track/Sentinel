import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { loadClientSettings } from "./lib/clientSettings";

// The database side of face match (faceMatchNode.ts): the client's
// settings, the identities behind matched faces, and the faces indexed in
// each client's Rekognition collection (so they can be deleted).

export const settingsFor = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const { screening } = await loadClientSettings(ctx, args.clientId);
    return { faceMatch: screening.faceMatch, duplicateFaceSearch: screening.duplicateFaceSearch };
  },
});

// The client's own earlier KYC checks behind matched faces. Another
// client's check is never returned.
export const identities = internalQuery({
  args: { clientId: v.id("clients"), verificationIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = [];
    for (const raw of args.verificationIds.slice(0, 10)) {
      const id = ctx.db.normalizeId("verifications", raw);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.clientId !== args.clientId) continue;
      const input = (row.input ?? {}) as { idNumber?: string; firstName?: string; lastName?: string };
      rows.push({
        verificationId: raw,
        reference: row.reference,
        idNumber: input.idNumber ?? null,
        name: [input.firstName, input.lastName].filter(Boolean).join(" ") || null,
        createdAt: row.createdAt,
      });
    }
    return rows;
  },
});

export const recordFace = internalMutation({
  args: { verificationId: v.id("verifications"), clientId: v.id("clients"), collectionId: v.string(), faceId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("faceRecords", { ...args, createdAt: Date.now() });
  },
});
