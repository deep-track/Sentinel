import { Shield } from "lucide-react";

// NOTE: searchAML previously came from actions/aml.ts, which called
// lib/opensanctions.ts directly (a third-party OpenSanctions API
// integration, independent of the Convex backend). Removed to keep the
// actions/ folder matching the backend's current shape — only
// auth-actions.ts and invitations.ts remain. There is no Convex
// equivalent yet, so this page cannot run a live search. Showing an
// honest unavailable state instead of a dead form.

export default function AMLCheckPage() {
  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary text-primary-foreground">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AML Screening & Sanctions Check</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Screen individuals and companies against global sanctions and watchlists.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
        <p className="text-amber-700 dark:text-amber-400 font-medium">
          AML screening is temporarily unavailable while the backend migrates to Convex.
        </p>
      </div>
    </div>
  );
}
