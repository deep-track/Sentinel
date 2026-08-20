import { Card } from "@/components/ui/card";

// NOTE: this page previously loaded profile/org data via getClientSession
// (lib/client-auth.ts) and direct Prisma queries against
// clientOrganization / clientMember. The Prisma schema and client were
// removed as part of the Convex migration (Convex now models this as
// "clients" + "clientMembers" — see convex/schema.ts — with different
// fields, and no linked "user" record with email/fullName). There is no
// Convex query yet to fetch the current user's client/membership, so this
// page can't load real data. Showing an honest unavailable state instead
// of faking a profile.

export default async function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Your profile and organization details
        </p>
      </div>

      <Card className="p-6 border-dashed">
        <p className="text-sm text-muted-foreground">
          Settings are temporarily unavailable while the backend migrates to
          Convex.
        </p>
      </Card>
    </div>
  );
}
