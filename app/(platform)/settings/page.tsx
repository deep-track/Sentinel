import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getClientSession } from "@/lib/client-auth";
import prisma from "@/lib/prisma";

async function getSettingsData() {
  const session = await getClientSession();
  if (!session) return null;

  const [org, member] = await Promise.all([
    prisma.clientOrganization.findUnique({
      where: { id: session.orgId },
      select: { name: true, slug: true, domain: true, plan: true, createdAt: true },
    }),
    prisma.clientMember.findFirst({
      where: { orgId: session.orgId, userId: session.userId },
      include: { user: { select: { email: true, fullName: true } } },
    }),
  ]);

  if (!org || !member) return null;

  return { org, member };
}

export default async function SettingsPage() {
  const data = await getSettingsData();

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

      {!data ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            No active session found, so settings can&apos;t be loaded right
            now. Sign in to view your profile and organization.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-6 bg-card border-border">
            <p className="text-sm font-medium text-foreground mb-4">
              Profile
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Name
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {data.member.user.fullName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {data.member.user.email}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Role
                </p>
                <Badge variant="outline" className="mt-1">
                  {data.member.role.replace("_", " ").toLowerCase()}
                </Badge>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-card border-border">
            <p className="text-sm font-medium text-foreground mb-4">
              Organization
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Name
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {data.org.name}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Slug
                </p>
                <p className="mt-1 text-sm text-foreground font-mono">
                  {data.org.slug}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Domain
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {data.org.domain ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plan
                </p>
                <Badge variant="secondary" className="mt-1 capitalize">
                  {data.org.plan}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Member since
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {new Date(data.org.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}