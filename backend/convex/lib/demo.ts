import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The demo organization (Demo Bank Ltd, clients.isDemo) holds seeded data
// for the manual and training videos. Back Office statistics leave it out,
// so it never inflates traffic, revenue, risk or review numbers.
export async function demoClientIds(ctx: QueryCtx): Promise<Set<Id<"clients">>> {
  const clients = await ctx.db.query("clients").take(1000);
  return new Set(clients.filter((client) => client.isDemo).map((client) => client._id));
}

// Keeps rows that don't belong to the demo organization.
export function withoutDemo<T extends { clientId: Id<"clients"> }>(rows: T[], demo: Set<Id<"clients">>): T[] {
  return demo.size === 0 ? rows : rows.filter((row) => !demo.has(row.clientId));
}
