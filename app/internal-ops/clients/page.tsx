export const dynamic = "force-dynamic";

import { Card } from "@/components/ui/card";

// NOTE: this page previously queried the old Prisma "Verification" /
// "ClientOrganization" models directly (a different, older schema than
// the Convex "verifications" / "clients" tables — e.g. caseId,
// sentinelScore, org relations that don't exist under Convex). The
// Prisma schema and client were removed as part of the Convex migration,
// and there's no Convex query yet that reproduces this cross-client feed.
// Showing an honest unavailable state instead of faking the log.

export default async function GlobalVerificationLogPage() {
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Global Verification Log
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every verification across every client, in one feed
        </p>
      </div>

      <Card className="p-6 border-dashed">
        <p className="text-sm text-muted-foreground">
          The verification log is temporarily unavailable while the backend
          migrates to Convex.
        </p>
      </Card>
    </div>
  );
}
