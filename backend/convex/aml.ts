import { ConvexError, v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import { buildVerificationReference } from "./lib/crypto";
import { assertCreditsForNewVerification, creditsForVerification } from "./lib/verificationTypes";
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
  RISK_TYPE_LABELS,
  describeAdverseMedia,
  fetchArticleText,
  gdeltProvider,
  screenAdverseMediaMany,
  WEB_SEARCH_PROVIDER,
  type AdverseMediaOutcome,
} from "./lib/adverseMedia";
import { MAX_EXTERNAL_REF_LENGTH, enrolMonitoredSubject } from "./lib/amlMonitoringStore";
import { DEFAULTS, loadClientSettings, monitoringIntervalMs, type ScreeningRules } from "./lib/clientSettings";
import { hitKey as clearedKey, stillCleared, subjectKeyFor } from "./lib/amlClearedMatches";
import { isCurrent, matchPepEntry, PEP_LEVEL_CLASS, PEP_LEVEL_LABELS, type PepEntry, type PepMatch } from "./lib/kenyaPep";
import { loadPepRegister } from "./pepRegister";
import { matchRiskEntry, riskListSource, type RiskEntry, type RiskMatch } from "./lib/riskLists";
import { loadRiskLists } from "./riskLists";
import { clearedHitsFor } from "./amlCleared";
import {
  OPENSANCTIONS_STRONG_MATCH_SCORE,
  OpenSanctionsRequestError,
  annotateBirthDates,
  applyPepPositions,
  categorize,
  fetchEntityNested,
  parsePepPositions,
  pepClass,
  riskCategories,
  combineWithOpenSanctions,
  matchOpenSanctionsMany,
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
  // For the customer risk rating (lib/riskRating.ts HIGH_RISK_INDUSTRIES, or free text).
  industry: v.optional(v.string()),
};

export type AmlSubjectDetails = {
  aliases?: string[];
  dateOfBirth?: string;
  nationality?: string;
  idNumber?: string;
  registrationNumber?: string;
  jurisdiction?: string;
  industry?: string;
};

type AmlRequest = AmlSubjectDetails & {
  clientId: Id<"clients">;
  subjectName: string;
  entityType: "individual" | "entity";
  country?: string;
};

// Ongoing monitoring options on a new screening: `monitor` enrols the
// subject, `externalRef` is the client's own customer id for it.
export const amlMonitoringOptionsValidator = {
  monitor: v.optional(v.boolean()),
  externalRef: v.optional(v.string()),
};

type MonitoringOptions = { monitor?: boolean; externalRef?: string };

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
  const industry = optionalText(args.industry, "Industry", 100);
  const details: AmlSubjectDetails = {
    ...(industry ? { industry } : {}),
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
  args: AmlRequest & MonitoringOptions & { actor: { actorId: string; actorType: AuditActorType } },
) {
  const { subjectName, country, details } = normalizeAmlRequest(args);
  const externalRef = optionalText(args.externalRef, "Customer reference", MAX_EXTERNAL_REF_LENGTH);
  // Without an explicit choice, the client's default (Settings → Screening
  // rules) decides whether the subject is monitored.
  const settings = await loadClientSettings(ctx, args.clientId);
  const monitor = args.monitor ?? settings.screening.monitoringDefault;
  if (externalRef && !monitor) invalid("A customer reference is only used with monitor: true.");
  await requireActiveClient(ctx, args.clientId);
  const creditsUsed = await creditsForVerification(ctx, args.clientId, "aml");
  // Balance check in the same transaction as the insert.
  await assertCreditsForNewVerification(ctx, args.clientId, creditsUsed);
  const now = Date.now();
  const reference = buildVerificationReference();
  const verificationId = await ctx.db.insert("verifications", {
    clientId: args.clientId,
    type: "aml",
    status: "queued",
    creditsUsed,
    input: { subjectName, entityType: args.entityType, country: country ?? null, ...details, ...(externalRef ? { externalRef } : {}) },
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
    ...(externalRef ? { externalRef } : {}),
  });
  const monitoring = monitor
    ? await enrolMonitoredSubject(ctx, {
        clientId: args.clientId,
        subjectName,
        entityType: args.entityType,
        country,
        ...details,
        externalRef,
        verificationId,
        enrolledBy: args.actor.actorId,
        intervalMs: monitoringIntervalMs(settings.screening.monitoringFrequency),
      })
    : null;
  await recordAudit(ctx, {
    ...args.actor,
    action: "verification.created",
    targetType: "verification",
    targetId: verificationId,
    clientId: args.clientId,
    metadata: { type: "aml", reference, ...(monitoring ? { monitoredSubject: monitoring.reference } : {}) },
  });
  return { verificationId, reference, monitoringId: monitoring?.reference ?? null };
}

export const submit = mutation({
  args: {
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: entityTypeValidator,
    country: v.optional(v.string()),
    ...amlSubjectDetailsValidator,
    ...amlMonitoringOptionsValidator,
  },
  handler: async (ctx, args) => {
    const { userId, role } = await requireClientRole(ctx, args.clientId, [
      "client_admin",
      "compliance_analyst",
      "reviewer",
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
    ...amlMonitoringOptionsValidator,
  },
  handler: async (ctx, args) => {
    const actor = { actorId: args.apiKeyId, actorType: "client_api_key" as const };
    const { apiKeyId: _apiKeyId, environment: _environment, ...request } = args;
    if (args.environment === "live") {
      const { reference, monitoringId } = await createAmlVerification(ctx, { ...request, actor });
      return { reference, status: "queued" as const, verdict: null, sandbox: false, monitoringId };
    }

    // Test-mode keys never enrol subjects for monitoring.
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
    return { reference, status: "completed" as const, verdict: "pass" as const, sandbox: true, monitoringId: null };
  },
});

export type ScreeningSubject = AmlSubjectDetails & {
  subjectName: string;
  entityType: "individual" | "entity";
  country?: string;
};

const OPENSANCTIONS_BATCH_SIZE = 20;
// Position lookups per screening batch (one OpenSanctions request each).
const MAX_POSITION_LOOKUPS = 20;
const MAX_POSITION_LOOKUPS_PER_SUBJECT = 3;

function toOpenSanctionsSubject(subject: ScreeningSubject) {
  return {
    name: subject.subjectName,
    entityType: subject.entityType,
    country: subject.country,
    aliases: subject.aliases,
    birthDate: subject.dateOfBirth,
    nationality: subject.nationality,
    idNumber: subject.idNumber,
    registrationNumber: subject.registrationNumber,
    jurisdiction: subject.jurisdiction,
  };
}

function logOpenSanctionsError(error: unknown) {
  // No subject data in the log line.
  console.error("[OpenSanctions] screening unavailable", {
    status: error instanceof OpenSanctionsRequestError ? error.status : undefined,
    message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
  });
}

// Never throws: any failure is reported as a coverage gap so the screening
// is held for review instead of passing or failing outright.
async function screenOpenSanctions(subjects: ScreeningSubject[]): Promise<OpenSanctionsOutcome[]> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY?.trim();
  if (!apiKey) return subjects.map(() => ({ status: "not_configured" as const }));
  const outcomes: OpenSanctionsOutcome[] = [];
  for (let start = 0; start < subjects.length; start += OPENSANCTIONS_BATCH_SIZE) {
    const batch = subjects.slice(start, start + OPENSANCTIONS_BATCH_SIZE);
    try {
      const results = await matchOpenSanctionsMany(batch.map(toOpenSanctionsSubject), { apiKey });
      results.forEach((result, index) => {
        if (result instanceof OpenSanctionsRequestError) {
          logOpenSanctionsError(result);
          outcomes.push({ status: "unavailable" });
        } else {
          outcomes.push({ status: "screened", matches: annotateBirthDates(result, batch[index].dateOfBirth) });
        }
      });
    } catch (error) {
      logOpenSanctionsError(error);
      for (const _ of batch) outcomes.push({ status: "unavailable" });
    }
  }
  await addPepPositions(outcomes, apiKey);
  return outcomes;
}

// Looks up recorded positions for relevant PEP matches (not close
// associates, who are always Class 4), so the PEP class comes from the
// actual office held. A failed lookup keeps the topic-based class.
async function addPepPositions(outcomes: OpenSanctionsOutcome[], apiKey: string) {
  let lookups = 0;
  for (const outcome of outcomes) {
    if (outcome.status !== "screened") continue;
    const relevant = new Set(relevantMatches(outcome.matches).map((match) => match.id));
    let perSubject = 0;
    for (let index = 0; index < outcome.matches.length; index++) {
      const match = outcome.matches[index];
      if (!relevant.has(match.id) || !match.topics.includes("role.pep")) continue;
      if (lookups >= MAX_POSITION_LOOKUPS || perSubject >= MAX_POSITION_LOOKUPS_PER_SUBJECT) return;
      lookups += 1;
      perSubject += 1;
      try {
        const entity = await fetchEntityNested(match.id, { apiKey });
        outcome.matches[index] = applyPepPositions(match, parsePepPositions(entity));
      } catch (error) {
        logOpenSanctionsError(error);
      }
    }
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

// Adverse media runs when ANTHROPIC_API_KEY is set. ADVERSE_MEDIA_PROVIDER:
// "claude_web_search" (default) searches with Claude's web search, "gdelt"
// uses GDELT's news index, "none" turns it off. Unlike the sanctions
// sources, an adverse media outage doesn't hold a screening for review: it
// is reported in coverage.adverseMedia.
async function screenAdverseMedia(subjects: ScreeningSubject[]): Promise<AdverseMediaOutcome[]> {
  const providerName = process.env.ADVERSE_MEDIA_PROVIDER?.trim().toLowerCase() || WEB_SEARCH_PROVIDER;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return screenAdverseMediaMany(
    subjects.map((subject) => ({
      name: subject.subjectName,
      entityType: subject.entityType,
      country: subject.country,
      aliases: subject.aliases,
      birthDate: subject.dateOfBirth,
      nationality: subject.nationality,
      registrationNumber: subject.registrationNumber,
      jurisdiction: subject.jurisdiction,
    })),
    {
      provider: providerName === "none" ? null : providerName === "gdelt" ? gdeltProvider() : WEB_SEARCH_PROVIDER,
      client: apiKey ? new Anthropic({ apiKey }) : null,
      fetchArticle: (url) => fetchArticleText(url),
      onError: (error) =>
        // No subject data in the log line.
        console.error("[AdverseMedia] screening unavailable", error instanceof Error ? error.message.slice(0, 200) : "unknown"),
    },
  );
}

// The outcome of screening one subject, in the shape amlPersistence.complete
// stores (minus the verification and client ids).
export type ScreeningOutcome = {
  verdict: "pass" | "review" | "reject";
  reason: string;
  complete: boolean;
  confidence?: number;
  coverage: {
    checked: Array<{ versionId: Id<"watchlistVersions">; sourceKey: SourceKey; fetchedAt: number; stale: boolean }>;
    missing: SourceKey[];
    stale: SourceKey[];
    openSanctions: OpenSanctionsOutcome["status"];
    adverseMedia: AdverseMediaOutcome["status"];
  };
  matches: Array<Record<string, unknown> & { source: string; sourceRecordId: string }>;
  candidateCount: number;
  // Hits left out because they were cleared for this customer before.
  suppressed: SuppressedMatch[];
};

// Screens subjects against the Sentinel-owned watchlists and OpenSanctions.
// The watchlist entries are read once for the whole batch, so ongoing
// monitoring can re-screen many subjects in one pass.
export type SuppressedMatch = {
  source: string;
  sourceRecordId: string;
  entityName: string;
  clearedAt: number;
  clearedByName: string | null;
  reasonCode: string | null;
};

// Applies a client's screening rules (Settings → Screening rules) to one
// subject's raw results: hits under the client's match threshold don't
// count, adverse media is limited to the categories they screen for, and
// hits already cleared for this customer (false-positive memory) are left
// out unless they've become more severe. Left-out cleared hits are returned
// so the report can show them.
export function applyScreeningRules<C extends { nameScore: number; sourceKey: string; sourceRecordId: string; primaryName: string }>(
  candidates: C[],
  openSanctions: OpenSanctionsOutcome,
  media: AdverseMediaOutcome,
  rules: ScreeningRules = DEFAULTS.screening,
): { candidates: C[]; openSanctions: OpenSanctionsOutcome; media: AdverseMediaOutcome; suppressed: SuppressedMatch[] } {
  const threshold = rules.matchThreshold;
  const categories = rules.adverseMediaCategories;
  const cleared = new Map((rules.cleared ?? []).map((hit) => [hit.key, hit]));
  const suppressed: SuppressedMatch[] = [];
  const isCleared = (source: string, sourceRecordId: string, entityName: string, current: Parameters<typeof stillCleared>[0]) => {
    const hit = cleared.get(clearedKey(source, sourceRecordId));
    if (!hit || !stillCleared(current, hit)) return false;
    suppressed.push({ source, sourceRecordId, entityName, clearedAt: hit.clearedAt, clearedByName: hit.clearedByName ?? null, reasonCode: hit.reasonCode ?? null });
    return true;
  };
  const result = {
    candidates: candidates.filter(
      (candidate) =>
        candidate.nameScore >= threshold &&
        !isCleared(candidate.sourceKey, candidate.sourceRecordId, candidate.primaryName, {
          categories: ["sanctions"],
          riskLevel: candidate.nameScore >= STRONG_MATCH_THRESHOLD ? "critical" : "high",
        }),
    ),
    openSanctions:
      openSanctions.status === "screened"
        ? {
            ...openSanctions,
            matches: openSanctions.matches.filter(
              (match) =>
                Math.round(match.score * 100) >= threshold &&
                !isCleared("OPENSANCTIONS", match.id, match.caption, {
                  categories: riskCategories(match),
                  pepClass: pepClass(match),
                  riskLevel: categorize(match) === "sanction" && match.score >= OPENSANCTIONS_STRONG_MATCH_SCORE ? "critical" : "high",
                }),
            ),
          }
        : openSanctions,
    media:
      media.status === "screened"
        ? {
            ...media,
            hits: media.hits.filter(
              (hit) =>
                (!categories || hit.riskTypes.some((type) => categories.includes(type))) &&
                !isCleared("ADVERSE_MEDIA", hit.url, hit.title, { categories: ["adverse_media"], riskLevel: "high" }),
            ),
          }
        : media,
  };
  return { ...result, suppressed };
}

// Register hits for one subject, under the client's match threshold and
// cleared-hit memory (cleared ones are added to `suppressed`).
function kenyanPepMatches(subject: ScreeningSubject, register: PepEntry[], rules: ScreeningRules | undefined, suppressed: SuppressedMatch[]): PepMatch[] {
  if (subject.entityType !== "individual" || register.length === 0) return [];
  const threshold = rules?.matchThreshold ?? DEFAULTS.screening.matchThreshold;
  const cleared = new Map((rules?.cleared ?? []).map((hit) => [hit.key, hit]));
  const matches: PepMatch[] = [];
  for (const entry of register) {
    const match = matchPepEntry({ name: subject.subjectName, dateOfBirth: subject.dateOfBirth }, entry);
    if (!match || match.nameScore < threshold) continue;
    const hit = cleared.get(clearedKey("KE_PEP", entry._id));
    if (hit && stillCleared({ categories: ["pep"], pepClass: PEP_LEVEL_CLASS[entry.level], riskLevel: "high" }, hit)) {
      suppressed.push({ source: "KE_PEP", sourceRecordId: entry._id, entityName: entry.fullName, clearedAt: hit.clearedAt, clearedByName: hit.clearedByName ?? null, reasonCode: hit.reasonCode ?? null });
      continue;
    }
    matches.push(match);
  }
  return matches.sort((left, right) => right.nameScore - left.nameScore).slice(0, MATCH_LIMIT);
}

// Kenyan risk list hits for one subject (people and organisations), under
// the client's threshold and cleared-hit memory.
function kenyanRiskListMatches(subject: ScreeningSubject, lists: RiskEntry[], rules: ScreeningRules | undefined, suppressed: SuppressedMatch[]): RiskMatch[] {
  if (lists.length === 0) return [];
  const threshold = rules?.matchThreshold ?? DEFAULTS.screening.matchThreshold;
  const cleared = new Map((rules?.cleared ?? []).map((hit) => [hit.key, hit]));
  const matches: RiskMatch[] = [];
  for (const entry of lists) {
    const match = matchRiskEntry({ name: subject.subjectName, entityType: subject.entityType }, entry);
    if (!match || match.nameScore < threshold) continue;
    const category = (riskListSource(entry.sourceKey)?.category ?? "fitness_probity") as "fitness_probity" | "special_interest";
    const hit = cleared.get(clearedKey("KE_RISK_LIST", entry._id));
    if (hit && stillCleared({ categories: [category], riskLevel: "high" }, hit)) {
      suppressed.push({ source: "KE_RISK_LIST", sourceRecordId: entry._id, entityName: entry.name, clearedAt: hit.clearedAt, clearedByName: hit.clearedByName ?? null, reasonCode: hit.reasonCode ?? null });
      continue;
    }
    matches.push(match);
  }
  return matches.sort((left, right) => right.nameScore - left.nameScore).slice(0, MATCH_LIMIT);
}

export async function screenSubjects(ctx: ActionCtx, subjects: ScreeningSubject[], rules?: ScreeningRules[], options?: { adverseMedia?: boolean }): Promise<ScreeningOutcome[]> {
  // Both run alongside the local watchlist scan; neither rejects.
  const openSanctionsPromise = screenOpenSanctions(subjects);
  // Off for bulk screenings (transaction counterparties): a web search
  // per name costs too much.
  const adverseMediaPromise: Promise<AdverseMediaOutcome[]> =
    options?.adverseMedia === false ? Promise.resolve(subjects.map(() => ({ status: "disabled" as const }))) : screenAdverseMedia(subjects);
  // Sentinel's Kenyan PEP register. Unavailable never blocks screening.
  const pepRegisterPromise: Promise<PepEntry[]> = subjects.some((subject) => subject.entityType === "individual")
    ? loadPepRegister(ctx).catch((error) => {
        console.error("[aml] PEP register unavailable", error instanceof Error ? error.message.slice(0, 120) : "unknown");
        return [];
      })
    : Promise.resolve([]);
  // Kenyan enforcement, debarment and wanted lists. Unavailable never blocks.
  const riskListsPromise: Promise<RiskEntry[]> = loadRiskLists(ctx).catch((error) => {
    console.error("[aml] Kenyan risk lists unavailable", error instanceof Error ? error.message.slice(0, 120) : "unknown");
    return [];
  });
  const coverage: Coverage = await ctx.runQuery(internalApi.amlPersistence.getActiveVersions, { now: Date.now() });
  const candidates: Array<Array<Candidate<Entry>>> = subjects.map(() => []);
  for (const version of coverage.versions) {
    let cursor: string | undefined;
    while (true) {
      const page = await ctx.runQuery(internalApi.amlPersistence.getEntryPage, {
        versionId: version._id,
        cursor,
        numItems: ENTRY_PAGE_SIZE,
      });
      for (const entry of page.page as Entry[]) {
        subjects.forEach((subject, index) => {
          const candidate = scoreCandidate(subject.subjectName, subject.entityType, subject.country, entry);
          if (candidate) candidates[index].push(candidate);
        });
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  const openSanctionsOutcomes = await openSanctionsPromise;
  const adverseMediaOutcomes = await adverseMediaPromise;
  const pepRegister = await pepRegisterPromise;
  const riskLists = await riskListsPromise;

  return subjects.map((_, index) => {
    const ruled = applyScreeningRules(candidates[index], openSanctionsOutcomes[index], adverseMediaOutcomes[index], rules?.[index]);
    const pepMatches = kenyanPepMatches(subjects[index], pepRegister, rules?.[index], ruled.suppressed);
    const riskListMatches = kenyanRiskListMatches(subjects[index], riskLists, rules?.[index], ruled.suppressed);
    const subjectCandidates = ruled.candidates.sort(compareCandidates);
    const openSanctions = ruled.openSanctions;
    // Decide on ALL candidates, then keep only the strongest for storage.
    const decision = combineWithOpenSanctions(finalDecision(subjectCandidates, coverage), openSanctions);
    const stored = subjectCandidates.slice(0, MATCH_LIMIT);
    const openSanctionsMatches = openSanctions.status === "screened" ? relevantMatches(openSanctions.matches) : [];
    const adverseMedia = ruled.media;
    const mediaHits = adverseMedia.status === "screened" ? adverseMedia.hits.slice(0, MATCH_LIMIT) : [];
    const hasAnyMatch = stored.length > 0 || openSanctionsMatches.length > 0 || mediaHits.length > 0;
    // Adverse media and Kenyan PEP hits can only make a verdict stricter
    // (pass → review).
    const verdict = (mediaHits.length > 0 || pepMatches.length > 0 || riskListMatches.length > 0) && decision.verdict === "pass" ? "review" : decision.verdict;
    const reason = [
      decision.reason,
      mediaHits.length > 0 ? describeAdverseMedia(mediaHits) : null,
      pepMatches.length > 0 ? `Possible Kenyan PEP: ${pepMatches.slice(0, 3).map((match) => `${match.entry.fullName} (${match.entry.position})`).join("; ")}.` : null,
      riskListMatches.length > 0 ? `On a Kenyan risk list: ${riskListMatches.slice(0, 3).map((match) => `${match.entry.name} (${riskListSource(match.entry.sourceKey)?.label ?? match.entry.sourceKey})`).join("; ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      verdict,
      reason,
      complete: decision.complete,
      confidence: !decision.complete && !hasAnyMatch ? 0 : undefined,
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
        adverseMedia: adverseMedia.status,
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
          ...(match.pepStatus ? { pepStatus: match.pepStatus } : {}),
          ...(match.pepPositions?.length ? { pepPositions: match.pepPositions.slice(0, 5) } : {}),
        })),
        ...pepMatches.map((match) => ({
          source: "KE_PEP" as const,
          sourceRecordId: match.entry._id,
          entityName: match.entry.fullName,
          program: [match.entry.position, match.entry.organisation, match.entry.county ? `${match.entry.county} County` : null].filter(Boolean).join(", "),
          matchScore: match.nameScore,
          matchMethod: match.method,
          matchedCountry: "KE",
          riskLevel: "high" as const,
          categories: ["pep" as const],
          pepClass: PEP_LEVEL_CLASS[match.entry.level],
          pepStatus: isCurrent(match.entry) ? ("current" as const) : ("former" as const),
          pepPositions: [{ title: `${match.entry.position}${match.entry.organisation ? `, ${match.entry.organisation}` : ""}`, country: "ke", startDate: match.entry.startDate, endDate: match.entry.endDate, current: isCurrent(match.entry) }],
          topics: [PEP_LEVEL_LABELS[match.entry.level]],
          ...(match.birthDateMatch !== "unknown" ? { birthDateMatch: match.birthDateMatch } : {}),
          ...(match.entry.relatedTo ? { datasets: [`Related to: ${match.entry.relatedTo}`] } : {}),
        })),
        ...riskListMatches.map((match) => ({
          source: "KE_RISK_LIST" as const,
          sourceRecordId: match.entry._id,
          entityName: match.entry.name,
          program: [riskListSource(match.entry.sourceKey)?.label, match.entry.action, match.ended ? "ended" : null].filter(Boolean).join(" - "),
          matchScore: match.nameScore,
          matchMethod: match.method,
          matchedCountry: "KE",
          riskLevel: "high" as const,
          categories: [(riskListSource(match.entry.sourceKey)?.category ?? "fitness_probity") as "fitness_probity" | "special_interest"],
          topics: [match.entry.reason.slice(0, 200)],
          datasets: [riskListSource(match.entry.sourceKey)?.authority ?? "Kenya", ...(match.entry.reference ? [`Ref. ${match.entry.reference}`] : [])],
        })),
        ...mediaHits.map((hit) => ({
          source: "ADVERSE_MEDIA" as const,
          sourceRecordId: hit.url,
          entityName: hit.title,
          program: hit.riskTypes.map((type) => RISK_TYPE_LABELS[type]).join(", "),
          matchScore: hit.severity === "high" ? 90 : 70,
          matchMethod: "ai_classification" as const,
          riskLevel: "high" as const,
          // Insolvency notices and regulator actions (e.g. from the Kenyan
          // official records) also count in those categories.
          categories: [
            "adverse_media" as const,
            ...(hit.riskTypes.includes("insolvency") ? (["insolvency"] as const) : []),
            ...(hit.riskTypes.includes("regulatory_action") ? (["fitness_probity"] as const) : []),
          ],
          media: {
            url: hit.url,
            title: hit.title,
            domain: hit.domain,
            publishedAt: hit.publishedAt,
            language: hit.language,
            sourceCountry: hit.sourceCountry,
            aboutSubject: hit.aboutSubject,
            severity: hit.severity,
            riskTypes: hit.riskTypes,
            summary: hit.summary,
          },
        })),
      ],
      candidateCount: subjectCandidates.length,
      suppressed: ruled.suppressed,
    };
  });
}

// Each subject's screening rules (its client's), in the order asked, with
// the hits already cleared for that customer when the client remembers them.
export const _screeningRules = internalQuery({
  args: { clientIds: v.array(v.id("clients")), subjectKeys: v.optional(v.array(v.union(v.string(), v.null()))) },
  handler: async (ctx, args): Promise<ScreeningRules[]> =>
    await Promise.all(
      args.clientIds.map(async (clientId, index) => {
        const { screening } = await loadClientSettings(ctx, clientId);
        const subjectKey = args.subjectKeys?.[index] ?? null;
        return {
          matchThreshold: screening.matchThreshold,
          adverseMediaCategories: screening.adverseMediaCategories,
          cleared: screening.rememberClearedMatches ? await clearedHitsFor(ctx, clientId, subjectKey) : [],
        };
      }),
    ),
});

export const runScreening = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    subjectName: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    country: v.optional(v.string()),
    ...amlSubjectDetailsValidator,
    // The client's customer reference (monitoring), which identifies the
    // customer for false-positive memory.
    externalRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.verifications._markProcessing, { id: args.verificationId });
    try {
      const { verificationId, clientId, externalRef, ...subject } = args;
      const subjectKey = subjectKeyFor({ ...subject, externalRef });
      const rules: ScreeningRules[] = await ctx.runQuery(internalApi.aml._screeningRules, { clientIds: [clientId], subjectKeys: [subjectKey] });
      const [outcome] = await screenSubjects(ctx, [subject], rules);
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId,
        clientId,
        subjectName: args.subjectName,
        verdict: outcome.verdict,
        reason: outcome.reason,
        confidence: outcome.confidence,
        chargeCredits: outcome.complete,
        complete: outcome.complete,
        coverage: outcome.coverage,
        matches: outcome.matches,
        ...(outcome.suppressed.length ? { suppressed: outcome.suppressed, subjectKey: subjectKey ?? undefined } : {}),
      });
      return { verdict: outcome.verdict, matches: outcome.candidateCount };
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
