import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { ShieldOutcome, ShieldSummary } from "@/backend/convex/lib/deepfakeShield";

// The deepfake shield headline on a report (backend/convex/lib/deepfakeShield.ts).

const STATUS_STYLE: Record<ShieldSummary["status"], { box: string; icon: typeof ShieldCheck }> = {
  clear: { box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200", icon: ShieldCheck },
  detected: { box: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200", icon: ShieldAlert },
  uncertain: { box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200", icon: ShieldQuestion },
  not_checked: { box: "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200", icon: ShieldQuestion },
};

const OUTCOME_LABEL: Record<ShieldOutcome, string> = { clear: "Clear", flagged: "Flagged", uncertain: "Unclear", not_run: "Not run" };
const OUTCOME_STYLE: Record<ShieldOutcome, string> = {
  clear: "text-emerald-700 dark:text-emerald-300",
  flagged: "text-red-700 dark:text-red-300",
  uncertain: "text-amber-700 dark:text-amber-300",
  not_run: "text-slate-500",
};

export function DeepfakeShield({ summary }: { summary: ShieldSummary }) {
  const style = STATUS_STYLE[summary.status];
  const Icon = style.icon;
  return (
    <div className={`rounded-2xl border p-5 ${style.box}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-75">Deepfake shield · DeepTrack Live</p>
          <p className="text-base font-semibold">{summary.headline}</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {summary.checks.map((check) => (
              <li key={check.name} className="flex flex-wrap gap-x-2">
                <span className={`font-semibold ${OUTCOME_STYLE[check.outcome]}`}>{OUTCOME_LABEL[check.outcome]}</span>
                <span className="font-medium">{check.name}</span>
                <span className="opacity-80">{check.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
