import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { buildVerificationReference } from "./lib/crypto";
import { requireClientRole } from "./lib/rbac";

const internalApi: any = internal;

const investorType = v.union(v.literal("individual"), v.literal("joint"), v.literal("corporate"), v.literal("fund"), v.literal("trust"), v.literal("institutional"));
const accreditationStatus = v.union(v.literal("accredited"), v.literal("qualified"), v.literal("institutional"), v.literal("retail"));
const sourceOfFunds = v.union(v.literal("employment"), v.literal("business"), v.literal("investments"), v.literal("inheritance"), v.literal("property"), v.literal("savings"), v.literal("other"));
const netWorthRange = v.union(v.literal("under_100k"), v.literal("100k_500k"), v.literal("500k_1m"), v.literal("1m_5m"), v.literal("above_5m"));
const governmentIdType = v.union(v.literal("passport"), v.literal("national_id"), v.literal("driving_license"));

export const createKyi = mutation({
  args: {
    clientId: v.id("clients"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    nationality: v.optional(v.string()),
    countryOfResidence: v.optional(v.string()),
    dateOfBirth: v.string(),
    investorType,
    accreditationStatus,
    sourceOfFunds,
    netWorthRange: v.optional(netWorthRange),
    investmentAmount: v.optional(v.number()),
    investmentCurrency: v.optional(v.string()),
    isPEP: v.boolean(),
    pepDetails: v.optional(v.string()),
    governmentIdType,
    governmentIdUrl: v.string(),
    governmentIdBase64: v.string(),
    governmentIdBackUrl: v.optional(v.string()),
    governmentIdBackBase64: v.optional(v.string()),
    selfieUrl: v.string(),
    selfieBase64: v.string(),
    bankStatementUrl: v.string(),
    proofOfAddressUrl: v.string(),
    proofOfNetWorthUrl: v.optional(v.string()),
    accreditationLetterUrl: v.optional(v.string()),
    sourceOfFundsDocUrl: v.optional(v.string()),
    corporateDocUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "compliance_analyst", "developer"]);

    const required: [unknown, string][] = [
      [args.firstName, "firstName"], [args.lastName, "lastName"], [args.email, "email"],
      [args.dateOfBirth, "dateOfBirth"], [args.governmentIdUrl, "governmentIdUrl"],
      [args.governmentIdBase64, "governmentIdBase64"], [args.selfieUrl, "selfieUrl"],
      [args.selfieBase64, "selfieBase64"], [args.bankStatementUrl, "bankStatementUrl"],
      [args.proofOfAddressUrl, "proofOfAddressUrl"],
    ];
    const missing = required.filter(([value]) => typeof value !== "string" || !value.trim()).map(([, name]) => name);
    if (missing.length > 0) {
      throw new ConvexError({ code: "invalid_argument", message: `Missing required fields: ${missing.join(", ")}` });
    }

    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") {
      throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
    }

    const now = Date.now();
    const reference = buildVerificationReference();

    const verificationId = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "kyi",
      status: "queued",
      creditsUsed: 1,
      input: {
        firstName: args.firstName,
        lastName: args.lastName,
        investorType: args.investorType,
        accreditationStatus: args.accreditationStatus,
        isPEP: args.isPEP,
      },
      reference,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("kyiRecords", {
      verificationId,
      clientId: args.clientId,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      nationality: args.nationality,
      countryOfResidence: args.countryOfResidence,
      dateOfBirth: args.dateOfBirth,
      investorType: args.investorType,
      accreditationStatus: args.accreditationStatus,
      sourceOfFunds: args.sourceOfFunds,
      netWorthRange: args.netWorthRange,
      investmentAmount: args.investmentAmount,
      investmentCurrency: args.investmentCurrency,
      isPEP: args.isPEP,
      pepDetails: args.pepDetails,
      governmentIdType: args.governmentIdType,
      governmentIdFrontUrl: args.governmentIdUrl, // wizard calls it *Url, schema calls it *FrontUrl
      governmentIdBackUrl: args.governmentIdBackUrl,
      selfieUrl: args.selfieUrl,
      bankStatementUrl: args.bankStatementUrl,
      proofOfAddressUrl: args.proofOfAddressUrl,
      proofOfNetWorthUrl: args.proofOfNetWorthUrl,
      accreditationLetterUrl: args.accreditationLetterUrl,
      sourceOfFundsDocUrl: args.sourceOfFundsDocUrl,
      corporateDocUrl: args.corporateDocUrl,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internalApi.kyi.processKyiVerification, {
      verificationId,
      clientId: args.clientId,
      governmentIdBase64: args.governmentIdBase64,
      governmentIdBackBase64: args.governmentIdBackBase64,
      selfieBase64: args.selfieBase64,
    });

    return { id: verificationId, reference };
  },
});

export const processKyiVerification = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    governmentIdBase64: v.string(),
    governmentIdBackBase64: v.optional(v.string()),
    selfieBase64: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.verifications._markProcessing, { id: args.verificationId });

    const record = await ctx.runQuery(internalApi.kyi._getByVerification, { verificationId: args.verificationId });
    if (!record) {
      await ctx.runMutation(internalApi.verifications._fail, { id: args.verificationId, reason: "No investor profile found for this verification." });
      return;
    }

   //checks the declared profile/documents and routes.
    const missingDocs: string[] = [];
    if (!record.bankStatementUrl) missingDocs.push("bank statement");
    if (!record.proofOfAddressUrl) missingDocs.push("proof of address");
    if (record.accreditationStatus !== "retail" && !record.accreditationLetterUrl) missingDocs.push("accreditation letter");

    if (missingDocs.length > 0) {
      await ctx.runMutation(internalApi.verifications._fail, {
        id: args.verificationId,
        reason: `Missing required documents: ${missingDocs.join(", ")}.`,
      });
      return;
    }

    if (record.isPEP) {
      await ctx.runMutation(internalApi.verifications._completeWithReview, {
        id: args.verificationId,
        clientId: args.clientId,
        result: { source: "kyi", reason: "self_declared_pep" },
        triggerType: "internal_flag",
        triggerReason: "Investor self-declared as a Politically Exposed Person.",
        priority: "high",
      });
      return;
    }

    if (record.accreditationStatus === "retail") {
      await ctx.runMutation(internalApi.verifications._completeWithReview, {
        id: args.verificationId,
        clientId: args.clientId,
        result: { source: "kyi", reason: "retail_accreditation" },
        triggerType: "internal_flag",
        triggerReason: "Investor is not accredited/qualified/institutional — requires manual suitability review.",
        priority: "normal",
      });
      return;
    }

    await ctx.runMutation(internalApi.verifications._complete, {
      id: args.verificationId,
      verdict: "pass",
      confidence: 0.8,
      result: { source: "kyi" },
    });
  },
});

export const _getByVerification = internalQuery({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) =>
    await ctx.db.query("kyiRecords").withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId)).unique(),
});

export const getByVerification = query({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) return null;
    await requireClientRole(ctx, verification.clientId, ["client_admin", "compliance_analyst", "developer", "viewer"]);
    return await ctx.db.query("kyiRecords").withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId)).unique();
  },
});