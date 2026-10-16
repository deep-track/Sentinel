import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { loadClientSettings } from "./lib/clientSettings";
import {
  findingsFor,
  identifiersOf,
  isFraudRejection,
  namePartsForHash,
  needsReview,
  normalizeIdentifier,
  reviewNote,
  type Finding,
  type Identifier,
  type NetworkSummary,
  type StoredSignal,
} from "./lib/fraudNetwork";

// Sentinel's fraud network (lib/fraudNetwork.ts): each finished check's
// identifiers are fingerprinted and compared with earlier checks - the
// client's own, and those of other clients when both joined the network.
// A strong signal sends a pass to review; it never rejects on its own.

// Earlier signals compared per identifier: enough to see reuse.
const MAX_EARLIER = 50;

type Verdict = "pass" | "review" | "reject";

async function hmacKey(ctx: MutationCtx): Promise<CryptoKey> {
  let row = await ctx.db.query("fraudNetworkKeys").withIndex("by_key", (q) => q.eq("key", "default")).unique();
  if (!row) {
    // Generated once and only ever read by Sentinel, so nobody handles it.
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = await ctx.db.insert("fraudNetworkKeys", { key: "default", secret, createdAt: Date.now() });
    row = (await ctx.db.get(id))!;
  }
  const raw = new Uint8Array(row.secret.match(/../g)!.map((pair) => parseInt(pair, 16)));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function fingerprint(key: CryptoKey, text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type Person = { identifiers: Identifier[]; name: string | null; dob: string | null; label?: string };

// Fingerprints one check's people, compares them with earlier checks and
// stores the new signals. Returns the findings.
async function screenPeople(
  ctx: MutationCtx,
  verification: Doc<"verifications">,
  people: Person[],
  outcome: StoredSignal["outcome"],
): Promise<{ network: boolean; identifiers: number; findings: Finding[] }> {
  const { screening } = await loadClientSettings(ctx, verification.clientId);
  const network = screening.shareFraudNetwork;
  const key = await hmacKey(ctx);
  // Whether each other client takes part, as of now: one that leaves the
  // network stops being seen at once.
  const sharing = new Map<string, boolean>([[verification.clientId, network]]);
  const shares = async (clientId: Id<"clients">) => {
    if (!sharing.has(clientId)) sharing.set(clientId, (await loadClientSettings(ctx, clientId)).screening.shareFraudNetwork);
    return sharing.get(clientId)!;
  };
  const existing = await ctx.db.query("fraudSignals").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(100);
  const findings: Finding[] = [];
  let identifiers = 0;
  const now = Date.now();
  for (const person of people) {
    const nameParts = person.name ? await Promise.all(namePartsForHash(person.name).map((part) => fingerprint(key, `name:${part}`))) : [];
    const dob = person.dob ? await fingerprint(key, `dob:${person.dob}`) : null;
    for (const identifier of person.identifiers) {
      const normalized = normalizeIdentifier(identifier.kind, identifier.value);
      if (!normalized) continue;
      identifiers += 1;
      const hash = await fingerprint(key, `${identifier.kind}:${normalized}`);
      const rows = await ctx.db.query("fraudSignals").withIndex("by_hash", (q) => q.eq("hash", hash)).order("desc").take(MAX_EARLIER);
      const earlier: StoredSignal[] = [];
      for (const row of rows) {
        earlier.push({
          kind: row.kind,
          clientId: row.clientId,
          verificationId: row.verificationId,
          nameParts: row.nameParts,
          dob: row.dob ?? null,
          outcome: row.outcome,
          shared: await shares(row.clientId),
          createdAt: row.createdAt,
        });
      }
      for (const finding of findingsFor(identifier.kind, { clientId: verification.clientId, verificationId: verification._id, nameParts, dob, network }, earlier)) {
        findings.push(person.label ? { ...finding, message: `${person.label}: ${finding.message}` } : finding);
      }
      if (!existing.some((row) => row.hash === hash)) {
        await ctx.db.insert("fraudSignals", { hash, kind: identifier.kind, clientId: verification.clientId, verificationId: verification._id, nameParts, ...(dob ? { dob } : {}), outcome, createdAt: now });
      }
    }
  }
  return { network, identifiers, findings };
}

// Runs the network for a check about to complete with `verdict`. Returns
// the final verdict (a pass becomes review on a strong signal), the summary
// for result.fraudNetwork and the note for the reason.
export async function checkFraudNetwork(
  ctx: MutationCtx,
  verification: Doc<"verifications">,
  verdict: Verdict,
  result: unknown,
): Promise<{ verdict: Verdict; summary: NetworkSummary | null; note: string | null }> {
  let people: Person[];
  if (verification.type === "kyb") {
    const directors = await ctx.db.query("kybDirectors").withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", verification._id)).take(50);
    people = directors.map((director) => {
      const name = `${director.firstName} ${director.lastName}`.trim();
      return {
        identifiers: [
          { kind: "id_number" as const, value: director.idNumber },
          { kind: "email" as const, value: director.email },
        ],
        name,
        dob: /^\d{4}-\d{2}-\d{2}$/.test(director.dateOfBirth) ? director.dateOfBirth : null,
        label: name || "A director",
      };
    });
  } else {
    people = [identifiersOf({ type: verification.type, input: verification.input, result })];
  }
  if (!people.some((person) => person.identifiers.length)) return { verdict, summary: null, note: null };
  const fraud = verdict === "reject" && isFraudRejection(result);
  const screened = await screenPeople(ctx, verification, people, fraud ? "fraud" : verdict);
  if (!screened.identifiers) return { verdict, summary: null, note: null };
  const escalate = verdict === "pass" && needsReview(screened.findings);
  return {
    verdict: escalate ? "review" : verdict,
    summary: { checkedAt: Date.now(), network: screened.network, identifiers: screened.identifiers, findings: screened.findings.slice(0, 20) },
    note: escalate ? reviewNote(screened.findings) : null,
  };
}

// A review decision: the check's signals carry the final outcome, so later
// checks see an identifier that was in a fraud rejection.
export async function recordFraudOutcome(ctx: MutationCtx, verification: Doc<"verifications">, finalVerdict: "pass" | "reject", reviewReason: string | null) {
  const outcome: StoredSignal["outcome"] = finalVerdict === "pass" ? "pass" : isFraudRejection(verification.result, reviewReason) ? "fraud" : "reject";
  for (const row of await ctx.db.query("fraudSignals").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(100)) {
    if (row.outcome !== outcome) await ctx.db.patch(row._id, { outcome });
  }
}

// DeepTrack: drops a check's signals (e.g. test data entered with real
// identifiers by mistake).
export const removeSignals = internalMutation({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("fraudSignals").withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId)).take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});
