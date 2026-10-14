import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { randomKeySegment } from "./crypto";
import type { PepClass, RiskCategory } from "./amlCategories";

// Ongoing AML monitoring: monitored subjects are re-screened on a schedule
// (amlMonitoring.runDue) and only hits that are new, or have become more
// severe, since the last complete screening raise an alert.

export const DAY_MS = 24 * 60 * 60 * 1000;
// How often a monitored subject is re-screened.
export const RESCREEN_INTERVAL_MS = DAY_MS;
// Retry delay when a screening was incomplete (a list or OpenSanctions was
// unavailable): the baseline is left alone and nothing is alerted.
export const INCOMPLETE_RETRY_MS = 60 * 60 * 1000;
export const MAX_STORED_HITS = 50;
export const MAX_EXTERNAL_REF_LENGTH = 100;

export type MonitoredHit = {
  key: string;
  source: string;
  sourceRecordId: string;
  entityName: string;
  categories: RiskCategory[];
  pepClass?: PepClass;
  riskLevel: "critical" | "high";
};

type MatchLike = {
  source: string;
  sourceRecordId: string;
  entityName: string;
  categories?: RiskCategory[];
  pepClass?: PepClass;
  riskLevel: "critical" | "high";
};

export function hitKey(match: { source: string; sourceRecordId: string }): string {
  return `${match.source}:${match.sourceRecordId}`;
}

export function hitsFromMatches(matches: MatchLike[]): MonitoredHit[] {
  const seen = new Set<string>();
  const hits: MonitoredHit[] = [];
  for (const match of matches) {
    const key = hitKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      key,
      source: match.source,
      sourceRecordId: match.sourceRecordId,
      entityName: match.entityName,
      categories: match.categories ?? [],
      ...(match.pepClass ? { pepClass: match.pepClass } : {}),
      riskLevel: match.riskLevel,
    });
  }
  return hits.slice(0, MAX_STORED_HITS);
}

// What changed between the baseline and a new complete screening.
//   added      hits that weren't there before
//   escalated  known hits that gained a category, moved to a more senior PEP
//              class, or became critical
//   removed    hits that are gone (e.g. delisted); recorded, never alerted
export function diffHits(baseline: MonitoredHit[], current: MonitoredHit[]) {
  const before = new Map(baseline.map((hit) => [hit.key, hit]));
  const after = new Map(current.map((hit) => [hit.key, hit]));
  const added = current.filter((hit) => !before.has(hit.key));
  const escalated = current.filter((hit) => {
    const previous = before.get(hit.key);
    if (!previous) return false;
    if (hit.categories.some((category) => !previous.categories.includes(category))) return true;
    if (hit.pepClass && (!previous.pepClass || hit.pepClass < previous.pepClass)) return true;
    return hit.riskLevel === "critical" && previous.riskLevel !== "critical";
  });
  const removed = baseline.filter((hit) => !after.has(hit.key));
  return { added, escalated, removed };
}

export function buildMonitoringReference(): string {
  return `mon_${randomKeySegment(16)}`;
}

type SubjectFields = Pick<
  Doc<"amlMonitoredSubjects">,
  | "subjectName"
  | "entityType"
  | "country"
  | "aliases"
  | "dateOfBirth"
  | "nationality"
  | "idNumber"
  | "registrationNumber"
  | "jurisdiction"
>;

// Enrols a subject for monitoring from a new AML screening. With an
// externalRef already being monitored, that subject is updated in place (a
// client re-screening their customer) instead of creating a duplicate. The
// baseline is set when the enrolment screening completes
// (amlPersistence.completeScreening).
export async function enrolMonitoredSubject(
  ctx: MutationCtx,
  params: SubjectFields & {
    clientId: Id<"clients">;
    externalRef?: string;
    verificationId: Id<"verifications">;
    enrolledBy: string;
    // The client's re-screen frequency (Settings → Screening rules).
    intervalMs?: number;
  },
): Promise<{ subjectId: Id<"amlMonitoredSubjects">; reference: string }> {
  const now = Date.now();
  const intervalMs = params.intervalMs ?? RESCREEN_INTERVAL_MS;
  const fields = {
    subjectName: params.subjectName,
    entityType: params.entityType,
    country: params.country,
    aliases: params.aliases,
    dateOfBirth: params.dateOfBirth,
    nationality: params.nationality,
    idNumber: params.idNumber,
    registrationNumber: params.registrationNumber,
    jurisdiction: params.jurisdiction,
    enrolledVerificationId: params.verificationId,
    enrolledBy: params.enrolledBy,
    baselineSet: false,
    hits: [],
    nextScreenAt: now + intervalMs,
    updatedAt: now,
  };
  if (params.externalRef) {
    const existing = await ctx.db
      .query("amlMonitoredSubjects")
      .withIndex("by_client_and_external_ref", (q) => q.eq("clientId", params.clientId).eq("externalRef", params.externalRef))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { subjectId: existing._id, reference: existing.reference };
    }
  }
  const reference = buildMonitoringReference();
  const subjectId = await ctx.db.insert("amlMonitoredSubjects", {
    clientId: params.clientId,
    reference,
    status: "active",
    ...(params.externalRef ? { externalRef: params.externalRef } : {}),
    ...fields,
    screenCount: 0,
    alertCount: 0,
    createdAt: now,
  });
  return { subjectId, reference };
}

// Sets the baseline from the enrolment screening, when it was complete.
export async function setBaselineFromEnrolment(
  ctx: MutationCtx,
  verificationId: Id<"verifications">,
  matches: MatchLike[],
  intervalMs: number = RESCREEN_INTERVAL_MS,
) {
  const subject = await ctx.db
    .query("amlMonitoredSubjects")
    .withIndex("by_enrolled_verification", (q) => q.eq("enrolledVerificationId", verificationId))
    .first();
  if (!subject || subject.status !== "active" || subject.baselineSet) return;
  const now = Date.now();
  await ctx.db.patch(subject._id, {
    baselineSet: true,
    hits: hitsFromMatches(matches),
    lastScreenedAt: now,
    nextScreenAt: now + intervalMs,
    screenCount: subject.screenCount + 1,
    updatedAt: now,
  });
}
