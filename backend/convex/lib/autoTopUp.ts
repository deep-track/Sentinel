import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// After a charge (lib/credits.ts): when the balance falls to the client's
// automatic top-up threshold, charges the saved card (billing.autoTopUp),
// at most once every 12 hours so a failing card isn't retried in a loop.
export const AUTO_TOP_UP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function maybeAutoTopUp(ctx: MutationCtx, clientId: Id<"clients">, balance: number, now = Date.now()) {
  const billing = await ctx.db.query("clientBilling").withIndex("by_client", (q) => q.eq("clientId", clientId)).first();
  if (!billing?.autoTopUp?.enabled || !billing.card) return false;
  if (balance > billing.autoTopUp.thresholdCredits) return false;
  if (billing.lastAutoTopUpAt !== undefined && now - billing.lastAutoTopUpAt < AUTO_TOP_UP_COOLDOWN_MS) return false;
  await ctx.db.patch(billing._id, { lastAutoTopUpAt: now });
  await ctx.scheduler.runAfter(0, (internal as any).billing.autoTopUp, { clientId });
  return true;
}
