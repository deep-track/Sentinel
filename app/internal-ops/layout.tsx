import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser, isInternalOpsRole } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";
import { SentinelCanvas, SentinelLogo } from "@/components/sentinel/ui";
import { OpsNav } from "./ops-nav";

export const dynamic = "force-dynamic";

function initials(name: string) {
  const letters = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "?";
}

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

  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  if (!devBypass) {
    user = await getCurrentUser();
    if (!user) redirect("/auth/login");
    if (!isInternalOpsRole(user.role)) redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen">
      <SentinelCanvas className="sticky top-0 flex h-screen flex-shrink-0">
        <div className="w-1 flex-shrink-0 bg-sentinel-amber" aria-hidden="true" />
        <aside className="flex w-[208px] flex-col gap-1 overflow-y-auto border-r border-sentinel-line px-2.5 py-4">
          <div className="mb-2.5">
            <SentinelLogo caption="Sentinel Back Office · internal" />
          </div>
          <div className="mb-2.5 flex items-center gap-1.5 rounded-md border border-sentinel-amber-bg bg-sentinel-amber-deep px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 flex-shrink-0 text-sentinel-amber" aria-hidden="true" />
            <span className="text-[10px] font-medium text-sentinel-amber">
              Internal — not client visible{devBypass ? " (local dev: access check skipped)" : ""}
            </span>
          </div>
          <OpsNav />
          {user ? (
            <div className="mt-auto flex items-center gap-2 border-t border-sentinel-line pt-2.5">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-sentinel-chip bg-sentinel-line-soft text-[10px] text-sentinel-muted">
                {initials(user.fullName)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px]">{user.fullName}</div>
                <div className="truncate text-[10px] text-sentinel-subtle">
                  {user.role}
                  {user.viewOnly ? " · view only" : ""}
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </SentinelCanvas>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}
