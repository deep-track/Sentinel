import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCredits } from "./credits";

export type VerificationType = Doc<"verifications">["type"];

export function creditsForType(type: VerificationType): number {
  switch (type) {
    case "idp": return 1;
    case "kyi": return 1;
    case "kyb": return 3;
    case "aml": return 1;
    case "liveness": return 1;
  }
}

// Human-readable label used in ledger reasons and audit metadata.
export function verificationTypeLabel(type: VerificationType): string {
  switch (type) {
    case "idp": return "IDP verification";
    case "kyi": return "KYI verification";
    case "kyb": return "KYB verification";
    case "aml": return "AML sanctions screening";
    case "liveness": return "Liveness check";
  }
}

// Verifications still queued/processing are usually not charged yet (most
// flows charge on completion), so their cost is reserved against the
// balance. Rows already billed while in flight (e.g. liveness charges when
// the invitation is sent) are skipped so they aren't counted twice. Only
// recent rows count, so rows orphaned long ago can't lock a tenant out.
const IN_FLIGHT_WINDOW_MS = 60 * 60 * 1000;
const IN_FLIGHT_SCAN_LIMIT = 200;

// Call inside the mutation that inserts the verification. Reading the
// client's in-flight index range also makes concurrent creations for the same
// client conflict, so Convex serialises them and they can't both spend the
// last credit. Items parked in manual review (completed, verdict "review")
// are charged on resolution and are not reserved here.
export async function assertCreditsForNewVerification(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  amount: number,
) {
  if (amount <= 0) return;
  const since = Date.now() - IN_FLIGHT_WINDOW_MS;
  let reserved = 0;
  for (const status of ["queued", "processing"] as const) {
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_status", (q) =>
        q.eq("clientId", clientId).eq("status", status).gte("_creationTime", since),
      )
      .take(IN_FLIGHT_SCAN_LIMIT);
    for (const row of rows) {
      if (row.creditsUsed <= 0) continue;
      const alreadyCharged = await ctx.db
        .query("creditLedger")
        .withIndex("by_verification", (q) => q.eq("verificationId", row._id))
        .filter((q) => q.eq(q.field("type"), "deduction"))
        .first();
      if (!alreadyCharged) reserved += row.creditsUsed;
    }
  }
  await assertCredits(ctx, clientId, amount + reserved);
}

// Convex values (and therefore each function/scheduler argument string) are
// capped at 1 MiB, and all args scheduled by one mutation share a per-
// transaction budget. Base64 media above this size must move to file storage
// (follow-up); until then we reject it with a clear error instead of letting
// the scheduler throw after the row was written.
export const MAX_MEDIA_BASE64_CHARS = 1_000_000;

export function assertMediaSize(fields: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value.length > MAX_MEDIA_BASE64_CHARS) {
      throw new ConvexError({
        code: "payload_too_large",
        message: `${name} exceeds the ${MAX_MEDIA_BASE64_CHARS}-character limit. Compress or resize the image and try again.`,
      });
    }
  }
}
