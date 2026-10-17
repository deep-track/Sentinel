import { mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

// Display names for Auth0 user ids. Sentinel stores only the user id
// (identity.subject) on reviews, audit events and team rows, so the Back
// Office would otherwise show raw ids like "google-oauth2|1000…". Each
// signed-in user records their own name and email from the verified ID token
// (components/convex-client-provider.tsx); nobody can write another user's row.

const MAX_LENGTH = 120;

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_LENGTH) : undefined;
}

// A record's creation time. Some early rows were written with createdAt 0,
// which displays as Jan 1, 1970; Convex's own insert time is the real one.
export function createdTime(doc: { createdAt: number; _creationTime: number }): number {
  return doc.createdAt > 0 ? doc.createdAt : Math.floor(doc._creationTime);
}

// lastSeenAt is shown on the Team page; it doesn't need to be exact.
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export const recordMine = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const name = clean(identity.name);
    const email = clean(identity.email);
    if (!name && !email) return null;
    const now = Date.now();

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", identity.subject))
      .unique();
    if (existing) {
      const changed = existing.name !== name || existing.email !== email;
      const stale = !existing.lastSeenAt || now - existing.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS;
      if (changed || stale) {
        await ctx.db.patch(existing._id, { name, email, lastSeenAt: now, ...(changed ? { updatedAt: now } : {}) });
      }
      return null;
    }
    await ctx.db.insert("userProfiles", { userId: identity.subject, name, email, updatedAt: now, lastSeenAt: now });
    return null;
  },
});

// Name (or email) per user id, for ids that have a profile.
export async function profileNames(ctx: Pick<QueryCtx, "db">, ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => id && id !== "system");
  const rows = await Promise.all(
    unique.map((userId) => ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", userId)).unique()),
  );
  const names = new Map<string, string>();
  for (const row of rows) {
    const label = row?.name ?? row?.email;
    if (row && label) names.set(row.userId, label);
  }
  return names;
}
