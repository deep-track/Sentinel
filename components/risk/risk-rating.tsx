import { RISK_LEVEL_LABELS, type RiskLevel } from "@/backend/convex/lib/riskRating";

// A customer risk rating (backend/convex/lib/riskRating.ts): level, score
// and the factors behind it.

export type RatingView = { score: number; level: RiskLevel; factors: Array<{ factor: string; points: number; detail: string }>; reviewMonths: number | null; ratedAt?: number };

export const LEVEL_STYLE: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  prohibited: "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
};

export function RiskLevelBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[level]}`}>
      {RISK_LEVEL_LABELS[level]} risk{score !== undefined ? ` · ${score}` : ""}
    </span>
  );
}

export function RiskRatingDetail({ rating }: { rating: RatingView }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RiskLevelBadge level={rating.level} score={rating.score} />
        <span className="text-xs text-slate-500">
          {rating.reviewMonths === null ? "Exit or don't onboard: a confirmed sanctions match." : `Review every ${rating.reviewMonths} months.`}
        </span>
      </div>
      {rating.factors.length ? (
        <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          {rating.factors.map((factor, index) => (
            <li key={index}>
              <span className="font-medium">{factor.factor}</span> +{factor.points}: {factor.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No risk factors beyond the baseline.</p>
      )}
    </div>
  );
}
