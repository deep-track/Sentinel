import Link from "next/link";
import { AlertTriangle } from "lucide-react";

const internalOpsItems = [
  { title: "Overview", url: "/internal-ops" },
  { title: "Global Verification Log", url: "/internal-ops/verifications" },
  { title: "Client Accounts", url: "/internal-ops/clients" },
  { title: "Credit Ledger", url: "/internal-ops/ledger" },
  { title: "API Key Management", url: "/internal-ops/api-keys" },
  { title: "Review Queue", url: "/internal-ops/review-queue" },
  { title: "Model Metrics & Drift", url: "/internal-ops/model-metrics" },
  { title: "Audit Log", url: "/internal-ops/audit-log" },
  { title: "System Alerts", url: "/internal-ops/alerts" },
  { title: "Settings", url: "/internal-ops/settings" },
];

// TODO(backend): per the build plan (Section 7.2, 8), internal ops screens
// require a short-lived JWT with role internal_admin or reviewer, and
// should be IP-allowlisted to the Deeptrack VPN at the infrastructure
// layer. No internal-staff role or auth model exists in this backend yet
// (only client-side ClientRole: CLIENT_ADMIN, COMPLIANCE_ANALYST,
// DEVELOPER, VIEWER). Until that exists, this layout does not actually
// enforce any access control — it is open to anyone who reaches this
// route. Do not treat this as secure.

export default function InternalOpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 flex-shrink-0 bg-black text-white flex flex-col">
        <div className="p-4 border-b border-white/10">
          <span className="text-sm font-semibold tracking-wide">
            SENTINEL · INTERNAL OPS
          </span>
        </div>
        <nav className="flex-1 flex flex-col gap-1 p-3">
          {internalOpsItems.map((item) => (
            <Link
              key={item.url}
              href={item.url}
              className="px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col">
        <div className="bg-amber-500 text-black text-xs font-semibold tracking-wide px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          INTERNAL — NOT CLIENT VISIBLE
        </div>
        <main className="flex-1 bg-background">{children}</main>
      </div>
    </div>
  );
}