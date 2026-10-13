import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { buildVerificationReference } from "./lib/crypto";
import { assertCreditsForNewVerification, creditsForType } from "./lib/verificationTypes";
import { actorTypeForClientRole, recordAudit, type AuditActorType } from "./auditLog";
import {
  SOURCE_LABELS,
  STRONG_MATCH_THRESHOLD,
  compareCandidates,
  decide,
  joinList,
  scoreCandidate,
  type Candidate,
  type SourceKey,
} from "./lib/amlMatching";
import { isPartialIsoDate } from "./lib/amlCategories";
import {
  OPENSANCTIONS_STRONG_MATCH_SCORE,
  OpenSanctionsRequestError,
  annotateBirthDates,
  categorize,
  pepClass,
  riskCategories,
  combineWithOpenSanctions,
  matchOpenSanctions,
  relevantMatches,
  type OpenSanctionsOutcome,
} from "./lib/openSanctions";

const internalApi: any = internal;

const MATCH_LIMIT = 25;
const ENTRY_PAGE_SIZE = 500;
export const MAX_SUBJECT_NAME_LENGTH = 300;
export const MAX_COUNTRY_LENGTH = 100;
export const MAX_IDENTIFIER_LENGTH = 100;
export const MAX_ALIASES = 10;

const entityTypeValidator = v.union(v.literal("individual"), v.literal("entity"));

// Optional subject details that sharpen matching. Individuals: date of birth,
// nationality, national ID or passport number. Entities: registration number
// and jurisdiction. Both: known aliases.
export const amlSubjectDetailsValidator = {
  aliases: v.optional(v.array(v.string())),
  dateOfBirth: v.optional(v.string()),
  nationality: v.optional(v.string()),
  idNumber: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  jurisdiction: v.optional(v.string()),
};

export type AmlSubjectDetails = {
  aliases?: string[];
  dateOfBirth?: string;
  nationality?: string;
  idNumber?: string;
  registrationNumber?: string;
  jurisdiction?: string;
};

type AmlRequest = AmlSubjectDetails & {
  clientId: Id<"clients">;
  subjectName: string;
  entityType: "individual" | "entity";
  country?: string;
};

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

function optionalText(value: string | undefined, label: string, max: number) {
  const trimmed = value?.trim() || undefined;
  if (trimmed && trimmed.length > max) invalid(`${label} is too long.`);
  return trimmed;
}

export function normalizeAmlRequest(args: AmlRequest) {
  const subjectName = args.subjectName.trim();
  if (!subjectName) invalid("Subject name is required.");
  if (subjectName.length > MAX_SUBJECT_NAME_LENGTH) invalid("Subject name is too long.");
  const country = optionalText(args.country, "Country", MAX_COUNTRY_LENGTH);
  const aliases = [...new Set((args.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
  if (aliases.length > MAX_ALIASES) invalid(`At most ${MAX_ALIASES} aliases are allowed.`);
  if (aliases.some((alias) => alias.length > MAX_SUBJECT_NAME_LENGTH)) invalid("An alias is too long.");
  const individual = args.entityType === "individual";
  const dateOfBirth = optionalText(args.dateOfBirth, "Date of birth", 10);
  if (dateOfBirth && !individual) invalid("Date of birth applies to individuals only.");
  if (dateOfBirth && !isPartialIsoDate(dateOfBirth)) invalid("Date of birth must be YYYY, YYYY-MM or YYYY-MM-DD.");
  const nationality = optionalText(args.nationality, "Nationality", MAX_COUNTRY_LENGTH);
  const idNumber = optionalText(args.idNumber, "ID number", MAX_IDENTIFIER_LENGTH);
  const registrationNumber = optionalText(args.registrationNumber, "Registration number", MAX_IDENTIFIER_LENGTH);
  const jurisdiction = optionalText(args.jurisdiction, "Jurisdiction", MAX_COUNTRY_LENGTH);
  if ((nationality || idNumber) && !individual) invalid("Nationality and ID number apply to individuals only.");
  if ((registrationNumber || jurisdiction) && individual) {
    invalid("Registration number and jurisdiction apply to companies only.");
  }
  const details: AmlSubjectDetails = {
    ...(aliases.length ? { aliases } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(nationality ? { nationality } : {}),
    ...(idNumber ? { idNumber } : {}),
    ...(registrationNumber ? { registrationNumber } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
  };
  return { subjectName, country, details };
}

async function requireActiveClient(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get(clientId);
  if (!client || client.status !== "active") {
    throw new ConvexError({ code: "forbidden", message: "Client account is not active." });
  }
}

// Shared AML creation path (dashboard and public API). Checks credits,
// inserts the row, schedules screening and audits — all in the caller's
// transaction.
async function createAmlVerification(
  ctx: MutationCtx,
  args: AmlRequest & { actor: { actorId: string; actorType: AuditActorType } },
) {
  const { subjectName, country, details } = normalizeAmlRequest(args);
  await requireActiveClient(ctx, args.clientId);
  const creditsUsed = creditsForType("aml");
  // Balance check in the same transaction as the insert.
  await assertCreditsForNewVerification(ctx, args.clientId, creditsUsed);
  const now = Date.now();
  const reference = buildVerificationReference();
  const verificationId = await ctx.db.insert("verifications", {
    clientId: args.clientId,
    type: "aml",
    status: "queued",
    creditsUsed,
    input: { subjectName, entityType: args.entityType, country: country ?? null, ...details },
    reference,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internalApi.aml.runScreening, {
    verificationId,
    clientId: args.clientId,
    subjectName,
    entityType: args.entityType,
    country,
    ...details,
  });
  await recordAudit(ctx, {
    ...args.actor,
    action: "verification.created",
    targetType: "verification",
    targetId: verificationId,
    clientId: args.clientId,
    metadata: { type: "aml", reference },
  });
  return { verificationId, reference };
}

export const submit = mutation({
  args: {
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: entityTypeValidator,
    country: v.optional(v.string()),
    ...amlSubjectDetailsValidator,
  },
  handler: async (ctx, args) => {
    const { userId, role } = await requireClientRole(ctx, args.clientId, [
      "client_admin",
      "compliance_analyst",
      "developer",
    ]);
    const { verificationId } = await createAmlVerification(ctx, {
      ...args,
      actor: { actorId: userId, actorType: actorTypeForClientRole(role) },
    });
    return { verificationId };
  },
});

// POST /v1/verify/aml. Test-mode keys get a deterministic sandbox result
// (verdict "pass", status "completed", no screening, 0 credits).
export const _createFromApi = internalMutation({
  args: {
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    subjectName: v.string(),
    entityType: entityTypeValidator,
    country: v.optional(v.string()),
    ...amlSubjectDetailsValidator,
  },
  handler: async (ctx, args) => {
    const actor = { actorId: args.apiKeyId, actorType: "client_api_key" as const };
    const { apiKeyId: _apiKeyId, environment: _environment, ...request } = args;
    if (args.environment === "live") {
      const { reference } = await createAmlVerification(ctx, { ...request, actor });
      return { reference, status: "queued" as const, verdict: null, sandbox: false };
    }

    normalizeAmlRequest(request);
    await requireActiveClient(ctx, args.clientId);
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", {
      clientId: args.clientId,
      type: "aml",
      status: "completed",
      verdict: "pass",
      confidence: 1,
      creditsUsed: 0,
      input: { sandbox: true },
      result: {
        sandbox: true,
        reason: "Test-mode API key: no watchlists were screened and no credits were charged.",
        matches: [],
      },
      reference,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, { verificationId: id });
    await recordAudit(ctx, {
      ...actor,
      action: "verification.created",
      targetType: "verification",
      targetId: id,
      clientId: args.clientId,
      metadata: { type: "aml", reference, sandbox: true },
    });
    return { reference, status: "completed" as const, verdict: "pass" as const, sandbox: true };
  },
});

// Never throws: any failure is reported as a coverage gap so the screening
// is held for review instead of passing or failing outright.
async function screenOpenSanctions(
  subject: AmlSubjectDetails & { subjectName: string; entityType: "individual" | "entity"; country?: string },
): Promise<OpenSanctionsOutcome> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY?.trim();
  if (!apiKey) return { status: "not_configured" };
  try {
    const matches = await matchOpenSanctions(
      {
        name: subject.subjectName,
        entityType: subject.entityType,
        country: subject.country,
        aliases: subject.aliases,
        birthDate: subject.dateOfBirth,
        nationality: subject.nationality,
        idNumber: subject.idNumber,
        registrationNumber: subject.registrationNumber,
        jurisdiction: subject.jurisdiction,
      },
      { apiKey },
    );
    return { status: "screened", matches: annotateBirthDates(matches, subject.dateOfBirth) };
  } catch (error) {
    // No subject data in the log line.
    console.error("[OpenSanctions] screening unavailable", {
      status: error instanceof OpenSanctionsRequestError ? error.status : undefined,
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return { status: "unavailable" };
  }
}

type Entry = {
  _id: Id<"watchlistEntries">;
  versionId: Id<"watchlistVersions">;
  sourceKey: SourceKey;
  sourceRecordId: string;
  entityType: "individual" | "entity" | "unknown";
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  programs: string[];
  isActive: boolean;
};

type Coverage = {
  versions: Array<{
    _id: Id<"watchlistVersions">;
    sourceKey: SourceKey;
    fetchedAt: number;
    recordCount: number;
    stale: boolean;
  }>;
  missing: SourceKey[];
  stale: SourceKey[];
};

function describeCoverageGaps(coverage: Coverage): string {
  const gaps = [
    ...coverage.missing.map((key) => `${SOURCE_LABELS[key]} unavailable`),
    ...coverage.versions
      .filter((version) => version.stale)
      .map((version) => `${SOURCE_LABELS[version.sourceKey]} stale (last fetched ${new Date(version.fetchedAt).toISOString().slice(0, 10)})`),
  ];
  return gaps.join("; ");
}

// Builds the final verdict and reason. The reason only names lists that were
// actually screened, and incomplete coverage can never produce "pass".
function finalDecision(candidates: Array<Candidate<Entry>>, coverage: Coverage) {
  const decision = decide(candidates);
  const fresh = coverage.versions.filter((version) => !version.stale).map((version) => SOURCE_LABELS[version.sourceKey]);
  const staleChecked = coverage.versions.filter((version) => version.stale).map((version) => `${SOURCE_LABELS[version.sourceKey]} (stale)`);
  const checked = [...fresh, ...staleChecked];
  const complete = coverage.missing.length === 0 && coverage.stale.length === 0;

  if (complete) {
    return {
      verdict: decision.verdict,
      reason: decision.verdict === "pass" ? `No match found on the ${joinList(checked, "or")} watchlists.` : decision.reason,
      complete,
    };
  }

  const gaps = describeCoverageGaps(coverage);
  if (decision.verdict === "reject") {
    return { verdict: "reject" as const, reason: `${decision.reason} Watchlist coverage incomplete: ${gaps}.`, complete };
  }
  const screened =
    decision.verdict === "pass"
      ? checked.length > 0
        ? `No match found on ${joinList(checked, "or")}, but screening is incomplete.`
        : "No watchlist could be screened."
      : decision.reason;
  return {
    verdict: "review" as const,
    reason: `Watchlist unavailable or stale (${gaps}) — held for manual review. ${screened}`,
    complete,
  };
}

export const runScreening = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    country: v.optional(v.string()),
    ...amlSubjectDetailsValidator,
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.verifications._markProcessing, { id: args.verificationId });
    // Runs alongside the local watchlist scan; never rejects.
    const openSanctionsPromise = screenOpenSanctions(args);
    try {
      const coverage: Coverage = await ctx.runQuery(internalApi.amlPersistence.getActiveVersions, { now: Date.now() });
      const candidates: Array<Candidate<Entry>> = [];
      for (const version of coverage.versions) {
        let cursor: string | undefined;
        while (true) {
          const page = await ctx.runQuery(internalApi.amlPersistence.getEntryPage, {
            versionId: version._id,
            cursor,
            numItems: ENTRY_PAGE_SIZE,
          });
          for (const entry of page.page as Entry[]) {
            const candidate = scoreCandidate(args.subjectName, args.entityType, args.country, entry);
            if (candidate) candidates.push(candidate);
          }
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
      }
      candidates.sort(compareCandidates);
      const openSanctions = await openSanctionsPromise;
      // Decide on ALL candidates, then keep only the strongest for storage.
      const decision = combineWithOpenSanctions(finalDecision(candidates, coverage), openSanctions);
      const stored = candidates.slice(0, MATCH_LIMIT);
      const openSanctionsMatches = openSanctions.status === "screened" ? relevantMatches(openSanctions.matches) : [];
      const hasAnyMatch = stored.length > 0 || openSanctionsMatches.length > 0;
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: args.verificationId,
        clientId: args.clientId,
        subjectName: args.subjectName,
        verdict: decision.verdict,
        reason: decision.reason,
        confidence: !decision.complete && !hasAnyMatch ? 0 : undefined,
        chargeCredits: decision.complete,
        coverage: {
          checked: coverage.versions.map((version) => ({
            versionId: version._id,
            sourceKey: version.sourceKey,
            fetchedAt: version.fetchedAt,
            stale: version.stale,
          })),
          missing: coverage.missing,
          stale: coverage.stale,
          openSanctions: openSanctions.status,
        },
        matches: [
          ...stored.map((match) => ({
            entryId: match._id,
            versionId: match.versionId,
            source: match.sourceKey,
            sourceRecordId: match.sourceRecordId,
            entityName: match.primaryName,
            program: match.programs[0] ?? "unknown",
            matchScore: match.nameScore,
            matchMethod: match.method,
            matchedCountry: match.countries[0],
            countryMatch: match.countryMatch,
            riskLevel: match.nameScore >= STRONG_MATCH_THRESHOLD ? ("critical" as const) : ("high" as const),
            categories: ["sanctions" as const],
          })),
          ...openSanctionsMatches.slice(0, MATCH_LIMIT).map((match) => ({
            source: "OPENSANCTIONS" as const,
            sourceRecordId: match.id,
            entityName: match.caption,
            program: match.topics.join(", ") || match.datasets[0] || "unknown",
            matchScore: Math.round(match.score * 100),
            matchMethod: "provider_score" as const,
            matchedCountry: match.countries[0],
            riskLevel:
              categorize(match) === "sanction" && match.score >= OPENSANCTIONS_STRONG_MATCH_SCORE
                ? ("critical" as const)
                : ("high" as const),
            topics: match.topics.slice(0, 20),
            datasets: match.datasets.slice(0, 20),
            categories: riskCategories(match),
            ...(pepClass(match) ? { pepClass: pepClass(match)! } : {}),
            ...(match.birthDateMatch ? { birthDateMatch: match.birthDateMatch } : {}),
          })),
        ],
      });
      return { verdict: decision.verdict, matches: candidates.length };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "AML screening failed";
      await ctx.runMutation(internalApi.verifications._fail, { id: args.verificationId, reason: "AML screening unavailable; manual operational review required." });
      await ctx.runMutation(internalApi.auditLog._log, {
        actorId: "system",
        actorType: "system",
        action: "aml.screening_failed",
        targetType: "verification",
        targetId: args.verificationId,
        clientId: args.clientId,
        metadata: { reason: reason.slice(0, 500) },
      });
      await ctx.scheduler.runAfter(0, internal.webhooks.dispatchWebhook, {
        verificationId: args.verificationId,
      });
      throw error;
    }
  },
});
