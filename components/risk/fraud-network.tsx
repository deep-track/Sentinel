import type { NetworkSummary } from "@/backend/convex/lib/fraudNetwork";

// Sentinel's fraud network findings for one check (backend/convex/fraudNetwork.ts).

export function FraudNetworkDetail({ summary }: { summary: NetworkSummary }) {
  const scope = summary.network ? "your checks and the Sentinel network" : "your organization's checks";
  return (
    <div className="space-y-2 text-sm">
      {summary.findings.length ? (
        <ul className="space-y-1">
          {summary.findings.map((finding, index) => (
            <li key={index} className="flex items-start gap-2">
              <span
                className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  finding.severity === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                }`}
              >
                {finding.severity === "high" ? "Strong" : "Weak"}
              </span>
              <span className="text-slate-700 dark:text-slate-300">{finding.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-700 dark:text-slate-300">No reuse found: none of the identifiers turned up with another person or in a fraud rejection.</p>
      )}
      <p className="text-xs text-slate-500">
        {summary.identifiers} identifier{summary.identifiers === 1 ? "" : "s"} compared with {scope}, as keyed fingerprints only.
      </p>
    </div>
  );
}
