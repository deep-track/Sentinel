import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser, isInternalOpsRole } from "@/lib/auth";

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

const isAuth0Configured = Boolean(
  process.env.AUTH0_SECRET &&
  process.env.AUTH0_DOMAIN &&
  process.env.AUTH0_CLIENT_ID &&
  process.env.AUTH0_CLIENT_SECRET &&
  process.env.APP_BASE_URL,
);

// Real role check, per the build plan (Section 8): internal ops screens
// require role internal_admin or reviewer. Previously this layout had no
// enforcement at all (see prior TODO) because no role model existed for
// internal staff. lib/auth.ts now reads internal_admin/reviewer from the
// same AUTH0_ROLE_CLAIM already used for client roles, so this can
// actually gate access now.
//
// Local dev note: when Auth0 is disabled (dev-bypass mode), this grants
// internal_admin automatically so the pages remain testable without real
// credentials - matching the same pattern used in app/(platform)/layout.tsx.
// This bypass never applies once Auth0 is configured.
export default async function InternalOpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isAuth0Configured) {
    const user = await getCurrentUser();
    if (!user) redirect("/auth/login");
    if (!isInternalOpsRole(user.role)) redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 flex-shrink-0 bg-black text-white flex flex-col">
        <div className="p-4 border-b border-white/10">
          <span className="text-sm font-semibold tracking-wide">
            SENTINEL - INTERNAL OPS
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
          INTERNAL - NOT CLIENT VISIBLE
        </div>
        <main className="flex-1 bg-background">{children}</main>
      </div>
    </div>
  );
}