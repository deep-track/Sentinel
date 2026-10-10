import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser, isInternalOpsRole } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";

export const dynamic = "force-dynamic";

// Only pages that exist under app/internal-ops are listed here.
const internalOpsItems = [
  { title: "Screening Monitor", url: "/internal-ops/monitoring" },
  { title: "Verification Log", url: "/internal-ops/clients" },
];

// Internal ops screens require an internal Auth0 role (see
// backend/lib/roles.ts, mirroring backend/convex/lib/rbac.ts). The Convex
// queries behind each page enforce the same rule independently.
//
// Fail closed: in production an unconfigured Auth0 deployment returns 404.
// The local dev bypass (no Auth0 configured) only applies outside production.
export default async function InternalOpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { auth0, isAuth0Configured } = getAuth0();
  const authAvailable = isAuth0Configured && Boolean(auth0);
  const devBypass = !authAvailable && process.env.NODE_ENV !== "production";

  if (!authAvailable && !devBypass) notFound();

  if (!devBypass) {
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
          <Link
            href="/dashboard"
            className="mt-4 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            Back to dashboard
          </Link>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col">
        <div className="bg-amber-500 text-black text-xs font-semibold tracking-wide px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          INTERNAL - NOT CLIENT VISIBLE
          {devBypass ? " (LOCAL DEV: AUTH0 NOT CONFIGURED, ACCESS CHECK SKIPPED)" : null}
        </div>
        <main className="flex-1 bg-background">{children}</main>
      </div>
    </div>
  );
}
