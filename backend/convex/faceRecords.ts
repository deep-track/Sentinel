import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// Faces indexed for duplicate-face search (faceMatchNode.ts).

const internalApi: any = internal;

// Retention purge: the check's faces leave the collection too.
export async function purgeFaces(ctx: MutationCtx, verificationId: Id<"verifications">): Promise<number> {
  const rows = await ctx.db.query("faceRecords").withIndex("by_verification", (q) => q.eq("verificationId", verificationId)).take(20);
  const byCollection = new Map<string, string[]>();
  for (const row of rows) {
    byCollection.set(row.collectionId, [...(byCollection.get(row.collectionId) ?? []), row.faceId]);
    await ctx.db.delete(row._id);
  }
  for (const [collectionId, faceIds] of byCollection) {
    await ctx.scheduler.runAfter(0, internalApi.faceMatchNode.deleteFaces, { collectionId, faceIds });
  }
  return rows.length;
}
