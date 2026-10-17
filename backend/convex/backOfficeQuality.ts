import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { SOURCE_KEYS, SOURCE_LABELS } from "./lib/amlMatching";
import { requireInternalUser } from "./lib/rbac";
import { demoClientIds, withoutDemo } from "./lib/demo";

// Sentinel Back Office: model and data quality. How DeepTrack Live performs
// month by month (verdict mix, service errors, how often its result ended in
// review and how often a reviewer overturned it), and each watchlist's
// ingestion history.

const MAX_VERIFICATIONS = 10_000;
const MAX_VERSIONS = 200;
const RUNS_PER_SOURCE = 30;

export type LiveCheck = { kind: "selfie" | "video"; outcome: "real" | "fake" | "uncertain" | "error"; confidencePct: number | null };

// The DeepTrack Live checks in one verification result (pure; exported for
// tests). Selfie = KYC face check; video = KYC or hosted liveness clip.
export function liveChecks(result: unknown, input: unknown): LiveCheck[] {
  if (typeof result !== "object" || result === null) return [];
  const record = result as Record<string, unknown>;
  const checks: LiveCheck[] = [];
  const read = (value: unknown, kind: LiveCheck["kind"]) => {
    if (typeof value !== "object" || value === null) return;
    const entry = value as { prediction?: unknown; confidencePct?: unknown; error?: unknown };
    if ("error" in entry) {
      checks.push({ kind, outcome: "error", confidencePct: null });
      return;
    }
    if (entry.prediction === "real" || entry.prediction === "fake" || entry.prediction === "uncertain") {
      checks.push({
        kind,
        outcome: entry.prediction,
        confidencePct: typeof entry.confidencePct === "number" && Number.isFinite(entry.confidencePct) ? entry.confidencePct : null,
      });
    }
  };
  read(record.faceCheck, "selfie");
  const liveness = record.liveness as { deeptrackLive?: unknown; error?: unknown } | undefined;
  if (liveness && typeof liveness === "object") {
    if (liveness.deeptrackLive) read(liveness.deeptrackLive, "video");
    else if ("error" in liveness) {
      // A liveness error only counts against DeepTrack Live when the clip was
      // video (frame bundles go to the internal service).
      const mediaType = (input as { livenessMediaType?: unknown } | null)?.livenessMediaType;
      const hosted = record.source === "hosted_capture";
      if (hosted || mediaType === "mp4" || mediaType === "webm") checks.push({ kind: "video", outcome: "error", confidencePct: null });
    }
  }
  return checks;
}

type Bucket = { real: number; fake: number; uncertain: number; error: number; confidence: number[] };
const emptyBucket = (): Bucket => ({ real: 0, fake: 0, uncertain: 0, error: 0, confidence: [] });

export const quality = query({
  // monthStarts: start of each month to report, oldest first, in the viewer's
  // timezone (queries must not read the clock).
  args: { monthStarts: v.array(v.number()) },
  handler: async (ctx, args) => {
    await requireInternalUser(ctx);
    const monthStarts = [...args.monthStarts].sort((a, b) => a - b).slice(-12);
    const from = monthStarts[0] ?? 0;
    const monthIndex = (at: number) => {
      for (let index = monthStarts.length - 1; index >= 0; index -= 1) if (at >= monthStarts[index]) return index;
      return -1;
    };

    const fetched = await ctx.db
      .query("verifications")
      .withIndex("by_created_at", (q) => q.gte("createdAt", from))
      .order("desc")
      .take(MAX_VERIFICATIONS);
    // Demo Bank Ltd (the demo organization) holds seeded results, not real checks.
    const rows = withoutDemo(fetched, await demoClientIds(ctx));

    const months = monthStarts.map((monthStart) => ({
      monthStart,
      selfie: emptyBucket(),
      video: emptyBucket(),
      verifications: 0,
      heldForReview: 0,
      overturned: 0,
    }));
    const checked: Array<{ row: Doc<"verifications">; index: number }> = [];
    for (const row of rows) {
      const checks = liveChecks(row.result, row.input);
      if (checks.length === 0) continue;
      const index = monthIndex(row.createdAt);
      if (index < 0) continue;
      const month = months[index];
      month.verifications += 1;
      if (row.verdict === "review") month.heldForReview += 1;
      for (const check of checks) {
        const bucket = month[check.kind];
        bucket[check.outcome] += 1;
        if (check.confidencePct !== null) bucket.confidence.push(check.confidencePct);
      }
      checked.push({ row, index });
    }
    for (const { row, index } of checked) {
      const label = await ctx.db.query("feedbackLabels").withIndex("by_verification", (q) => q.eq("verificationId", row._id)).first();
      if (label && label.label !== "confirmed_correct") months[index].overturned += 1;
    }
    const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

    // Watchlist ingestion history, newest first.
    const versions = await ctx.db.query("watchlistVersions").order("desc").take(MAX_VERSIONS);
    const watchlists = SOURCE_KEYS.map((sourceKey) => {
      const runs = versions.filter((row) => row.sourceKey === sourceKey).slice(0, RUNS_PER_SOURCE);
      const succeeded = runs.filter((row) => row.status === "active" || row.status === "superseded");
      return {
        sourceKey,
        label: SOURCE_LABELS[sourceKey],
        runs: runs.map((row) => {
          const previous = succeeded.find((other) => other.fetchedAt < row.fetchedAt);
          const ok = row.status === "active" || row.status === "superseded";
          return {
            fetchedAt: row.fetchedAt,
            status: row.status,
            recordCount: ok ? row.recordCount : null,
            change: ok && previous ? row.recordCount - previous.recordCount : null,
            failureReason: row.failureReason ?? null,
          };
        }),
        recordCounts: [...succeeded].reverse().map((row) => ({ fetchedAt: row.fetchedAt, recordCount: row.recordCount })),
        failures: runs.filter((row) => row.status === "failed").length,
      };
    });

    return {
      truncated: fetched.length === MAX_VERIFICATIONS,
      months: months.map((month) => ({
        monthStart: month.monthStart,
        verifications: month.verifications,
        heldForReview: month.heldForReview,
        overturned: month.overturned,
        selfie: { real: month.selfie.real, fake: month.selfie.fake, uncertain: month.selfie.uncertain, error: month.selfie.error, avgConfidencePct: average(month.selfie.confidence) },
        video: { real: month.video.real, fake: month.video.fake, uncertain: month.video.uncertain, error: month.video.error, avgConfidencePct: average(month.video.confidence) },
      })),
      watchlists,
    };
  },
});
