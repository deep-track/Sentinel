import { ShieldCheck } from "lucide-react";

// Deepfake shield on the dashboard: deepfakes and AI forgeries caught in
// the last 30 days (backend/convex/lib/deepfakeShield.ts).
export function DeepfakeTile({ detected, checked }: { detected: number; checked: number }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-500 dark:text-slate-400">Deepfakes and AI forgeries stopped · last 30 days</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">
          {detected}
          <span className="ml-2 text-sm font-normal text-slate-500">of {checked} checks screened by DeepTrack Live and document forensics</span>
        </p>
      </div>
    </div>
  );
}
