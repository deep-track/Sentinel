import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import prisma from "@/lib/prisma";

async function getClientAccounts() {
  try {
    const orgs = await prisma.clientOrganization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        plan: true,
        scanCredits: true,
        scanCreditsUsed: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { members: true, verifications: true },
        },
      },
    });
    return orgs;
  } catch {
    return null;
  }
}

export default async function ClientAccountsPage() {
  const accounts = await getClientAccounts();

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Client Accounts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every tenant on Sentinel - plan, credit burn, and status
        </p>
      </div>

      {!accounts ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            Could not reach the database, so client accounts
            cannot be loaded right now. This is a database
            connection issue, not a page issue.
          </p>
        </Card>
      ) : accounts.length === 0 ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            No client organizations found in the database yet.
          </p>
        </Card>
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Credits used</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Verifications</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((org) => {
                const percentUsed =
                  org.scanCredits > 0
                    ? Math.round((org.scanCreditsUsed / org.scanCredits) * 100)
                    : 0;
                return (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium text-foreground">
                      {org.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {org.plan}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {org.scanCreditsUsed.toLocaleString()} /{" "}
                      {org.scanCredits.toLocaleString()} ({percentUsed}%)
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {org._count.members}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {org._count.verifications}
                    </TableCell>
                    <TableCell>
                      <Badge variant={org.isActive ? "success" : "secondary"}>
                        {org.isActive ? "active" : "suspended"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
