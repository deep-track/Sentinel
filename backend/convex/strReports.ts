import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import type { ClientRole } from "./lib/rbac";
import { randomKeySegment } from "./lib/crypto";
import { loadClientSettings } from "./lib/clientSettings";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { displayName } from "./reviewQueue";
import { buildGoamlXml, splitName, type GoamlInput } from "./lib/goaml";

// Suspicious transaction / activity reports (STR / SAR) prepared from a case
// for Kenya's Financial Reporting Centre (goAML). Sentinel keeps a register
// and builds a goAML XML draft; the compliance officer reviews it and
// submits it in goAML, then records the FRC reference here. The register is
// confidential (no tipping-off): Admins and Reviewers only.

const STR_ROLES: ClientRole[] = ["client_admin", "reviewer"];
const MAX_TEXT = 4000;
const MAX_INDICATORS = 20;

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function text(value: string | undefined, label: string, required: boolean, max = MAX_TEXT) {
  const trimmed = value?.trim() ?? "";
  if (required && !trimmed) invalid(`${label} is required.`);
  if (trimmed.length > max) invalid(`${label} is at most ${max} characters.`);
  return trimmed;
}

const transactionValidator = v.object({
  number: v.string(),
  date: v.number(),
  amount: v.number(),
  description: v.string(),
  transmodeCode: v.optional(v.string()),
  counterpartyName: v.optional(v.string()),
  counterpartyAccount: v.optional(v.string()),
});

// The subject of a check, in goAML terms.
export function goamlSubject(verification: Pick<Doc<"verifications">, "type" | "input" | "reference">): GoamlInput["subject"] {
  const input = (verification.input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof input[key] === "string" && (input[key] as string).trim() ? (input[key] as string).trim() : undefined);
  if (verification.type === "kyb" || (verification.type === "aml" && input.entityType === "entity")) {
    return {
      kind: "entity",
      name: str("businessName") ?? str("subjectName") ?? verification.reference,
      registrationNumber: str("registrationNumber"),
      incorporationCountry: str("incorporationCountry") ?? str("jurisdiction") ?? str("country"),
    };
  }
  const first = str("firstName");
  const last = str("lastName");
  const name = first || last ? { firstName: first ?? "", lastName: last ?? first ?? "" } : splitName(str("subjectName") ?? str("expectedName") ?? verification.reference);
  return {
    kind: "person",
    ...name,
    birthDate: str("dateOfBirth") ?? str("expectedDateOfBirth"),
    idNumber: str("idNumber"),
    nationality: str("nationality"),
    country: str("country"),
  };
}

async function loadForRead(ctx: QueryCtx, strId: Id<"strReports">) {
  const row = await ctx.db.get(strId);
  if (!row) return null;
  await requireClientRole(ctx, row.clientId, STR_ROLES);
  return row;
}

export const prepare = mutation({
  args: {
    verificationId: v.id("verifications"),
    reviewId: v.optional(v.id("reviewQueue")),
    reportCode: v.union(v.literal("STR"), v.literal("SAR")),
    reason: v.string(),
    action: v.string(),
    indicators: v.array(v.string()),
    transaction: v.optional(transactionValidator),
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) throw new ConvexError({ code: "not_found", message: "Check not found." });
    const actor = await requireClientRole(ctx, verification.clientId, STR_ROLES);
    const { profile } = await loadClientSettings(ctx, verification.clientId);
    if (!profile.goamlEntityId) invalid("Add your goAML reporting entity ID in Settings → Organization first.");
    if (!profile.complianceContactName) invalid("Add your compliance contact (the reporting person) in Settings → Organization first.");
    const reason = text(args.reason, "The reason for suspicion", true);
    const action = text(args.action, "The action taken", true, 1000);
    const indicators = [...new Set(args.indicators.map((code) => code.trim()).filter(Boolean))];
    if (indicators.length > MAX_INDICATORS || indicators.some((code) => code.length > 50)) invalid(`At most ${MAX_INDICATORS} indicator codes of 50 characters each.`);
    let transaction = args.transaction;
    if (args.reportCode === "STR") {
      if (!transaction) invalid("An STR needs the suspicious transaction. Use SAR for activity without a transaction.");
      if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) invalid("The transaction amount must be more than 0.");
      transaction = {
        ...transaction,
        number: text(transaction.number, "The transaction number", true, 100),
        description: text(transaction.description, "The transaction description", true, 1000),
        transmodeCode: transaction.transmodeCode?.trim() || undefined,
        counterpartyName: transaction.counterpartyName?.trim() || undefined,
        counterpartyAccount: transaction.counterpartyAccount?.trim() || undefined,
      };
    } else {
      transaction = undefined;
    }
    if (args.reviewId) {
      const review = await ctx.db.get(args.reviewId);
      if (!review || review.verificationId !== verification._id) invalid("That case doesn't belong to this check.");
    }
    const now = Date.now();
    const entityReference = `STR-${new Date(now).toISOString().slice(0, 10).replace(/-/g, "")}-${randomKeySegment(6).toUpperCase()}`;
    const strId = await ctx.db.insert("strReports", {
      clientId: verification.clientId,
      verificationId: verification._id,
      ...(args.reviewId ? { reviewId: args.reviewId } : {}),
      reportCode: args.reportCode,
      status: "draft",
      entityReference,
      reason,
      action,
      indicators,
      ...(transaction ? { transaction } : {}),
      createdBy: actor.userId,
      createdByName: displayName(await ctx.auth.getUserIdentity()),
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "str.prepared",
      targetType: "strReport",
      targetId: strId,
      clientId: verification.clientId,
      // The register itself holds the details; the audit log says only that
      // a report was prepared.
      metadata: { reportCode: args.reportCode, entityReference, reference: verification.reference },
    });
    return { strId, entityReference };
  },
});

export const markSubmitted = mutation({
  args: { strId: v.id("strReports"), frcReference: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.strId);
    if (!row) throw new ConvexError({ code: "not_found", message: "Report not found." });
    const actor = await requireClientRole(ctx, row.clientId, STR_ROLES);
    const frcReference = text(args.frcReference, "The FRC reference", true, 100);
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "submitted", frcReference, submittedAt: now, submittedBy: actor.userId, updatedAt: now });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "str.submitted",
      targetType: "strReport",
      targetId: row._id,
      clientId: row.clientId,
      metadata: { reportCode: row.reportCode, entityReference: row.entityReference, frcReference },
    });
    return null;
  },
});

export const xml = query({
  args: { strId: v.id("strReports") },
  handler: async (ctx, args) => {
    const row = await loadForRead(ctx, args.strId);
    if (!row) return null;
    const [verification, client, settings] = await Promise.all([ctx.db.get(row.verificationId), ctx.db.get(row.clientId), loadClientSettings(ctx, row.clientId)]);
    if (!verification || !client) return null;
    const { profile } = settings;
    const person = splitName(profile.complianceContactName ?? "");
    const document = buildGoamlXml({
      reportCode: row.reportCode,
      rentityId: profile.goamlEntityId ?? "",
      rentityBranch: profile.goamlBranch,
      entityReference: row.entityReference,
      submissionDate: new Date(row.createdAt),
      localCurrency: client.billingCurrency === "USD" ? "USD" : "KES",
      reportingPerson: { ...person, email: profile.complianceContactEmail, phone: profile.complianceContactPhone, title: "MLRO" },
      location: { address: profile.address, city: profile.city, countryCode: "KE" },
      reason: row.reason,
      action: row.action,
      indicators: row.indicators,
      subject: goamlSubject(verification),
      ...(row.transaction ? { transaction: { ...row.transaction, date: new Date(row.transaction.date) } } : {}),
    });
    return { xml: document, fileName: `${row.entityReference}-${row.reportCode}.xml` };
  },
});

function summary(row: Doc<"strReports">, verification: Doc<"verifications"> | null) {
  return {
    _id: row._id,
    reportCode: row.reportCode,
    status: row.status,
    entityReference: row.entityReference,
    frcReference: row.frcReference ?? null,
    reason: row.reason,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt ?? null,
    verification: verification ? { _id: verification._id, reference: verification.reference, type: verification.type, subject: goamlSubject(verification) } : null,
    reviewId: row.reviewId ?? null,
  };
}

export const list = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, STR_ROLES);
    const rows = await ctx.db
      .query("strReports")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(200);
    const verifications = await Promise.all(rows.map((row) => ctx.db.get(row.verificationId)));
    return rows.map((row, index) => summary(row, verifications[index]));
  },
});

export const forVerification = query({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) return [];
    try {
      await requireClientRole(ctx, verification.clientId, STR_ROLES);
    } catch {
      return [];
    }
    const rows = await ctx.db
      .query("strReports")
      .withIndex("by_verification", (q) => q.eq("verificationId", verification._id))
      .take(20);
    return rows.map((row) => summary(row, verification));
  },
});
