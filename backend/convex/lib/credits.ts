import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type LedgerType = "allocation" | "deduction" | "refund" | "adjustment";

// Sums the full ledger. Only used to backfill `clients.creditBalance` for rows
// created before the running balance existed.
async function sumLedger(ctx: QueryCtx, clientId: Id<"clients">) {
  let total = 0;
  for await (const row of ctx.db
    .query("creditLedger")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))) {
    total += row.amount;
  }
  return total;
}

export async function getBalance(ctx: QueryCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get(clientId);
  if (!client) throw new ConvexError({ code: "not_found", message: "Client not found." });
  return client.creditBalance ?? (await sumLedger(ctx, clientId));
}

/**
 * Ledger amounts are signed: deductions consume credits (negative), allocations
 * and refunds add them (allocation may be 0 for zero-credit plans), and
 * adjustments may go either way. Throws for rows whose sign contradicts the type.
 */
function assertLedgerAmount(type: LedgerType, amount: number) {
  const valid =
    Number.isFinite(amount) &&
    (type === "deduction"
      ? amount < 0
      : type === "allocation"
        ? amount >= 0
        : type === "refund"
          ? amount > 0
          : amount !== 0);
  if (!valid) {
    throw new ConvexError({
      code: "invalid_argument",
      message: `Invalid ${type} amount: ${amount}.`,
    });
  }
}

// Inserts a ledger row and updates the running balance in the same transaction.
export async function recordLedgerEntry(
  ctx: MutationCtx,
  entry: {
    clientId: Id<"clients">;
    verificationId?: Id<"verifications">;
    type: LedgerType;
    amount: number;
    reason: string;
  },
) {
  assertLedgerAmount(entry.type, entry.amount);
  const balance = await getBalance(ctx, entry.clientId);
  await ctx.db.insert("creditLedger", { ...entry, createdAt: Date.now() });
  await ctx.db.patch(entry.clientId, { creditBalance: balance + entry.amount });
  return balance + entry.amount;
}

// Throws `insufficient_credits` unless the client can afford `amount`.
// Call inside the same mutation that creates the verification so the check and
// the later charge are serialized by Convex's transactional writes.
export async function assertCredits(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  amount: number,
) {
  const balance = await getBalance(ctx, clientId);
  if (balance < amount) {
    throw new ConvexError({
      code: "insufficient_credits",
      message: "Insufficient credits for this verification.",
    });
  }
  return balance;
}

// Charges a verification exactly once: a second call for the same
// verificationId is a no-op, so retries and review resolutions can't double-bill.
// Affordability is enforced when the verification is created
// (assertCreditsForNewVerification reserves in-flight costs); by the time this
// runs the work has been done, so the charge is always recorded even if a race
// left the balance short, rather than silently giving the check away for free.
export async function chargeVerification(
  ctx: MutationCtx,
  args: {
    clientId: Id<"clients">;
    verificationId: Id<"verifications">;
    amount: number;
    reason: string;
  },
) {
  const existing = await ctx.db
    .query("creditLedger")
    .withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId))
    .filter((q) => q.eq(q.field("type"), "deduction"))
    .first();
  if (existing || args.amount <= 0) return false;
  await recordLedgerEntry(ctx, {
    clientId: args.clientId,
    verificationId: args.verificationId,
    type: "deduction",
    amount: -Math.abs(args.amount),
    reason: args.reason,
  });
  return true;
}
