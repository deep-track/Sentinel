export const dynamic = "force-dynamic";

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
import type { Prisma, VerificationType, VerificationStatus } from "@prisma/client";

const VALID_TYPES: VerificationType[] = ["KYC", "KYB", "KYI"];
const VALID_STATUSES: VerificationStatus[] = [
  "STARTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ESCALATED",
  "EXPIRED",
];

const statusTone: Record<string, "success" | "destructive" | "secondary" | "outline"> = {
  APPROVED: "success",
  REJECTED: "destructive",
  PENDING_REVIEW: "outline",
  ESCALATED: "destructive",
  STARTED: "secondary",
  EXPIRED: "secondary",
};

async function getVerifications(filters: {
  clientId?: string;
  type?: string;
  status?: string;
  search?: string;
}) {
  try {
    const where: Prisma.VerificationWhereInput = {};
    if (filters.clientId) where.orgId = filters.clientId;
    if (filters.type && VALID_TYPES.includes(filters.type as VerificationType)) {
      where.type = filters.type as VerificationType;
    }
    if (filters.status && VALID_STATUSES.includes(filters.status as VerificationStatus)) {
      where.status = filters.status as VerificationStatus;
    }
    if (filters.search) {
      where.OR = [
        { subjectName: { contains: filters.search, mode: "insensitive" } },
        { subjectRef: { contains: filters.search, mode: "insensitive" } },
        { caseId: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [verifications, clients] = await Promise.all([
      prisma.verification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { org: { select: { id: true, name: true } } },
      }),
      prisma.clientOrganization.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    return { verifications, clients };
  } catch {
    return null;
  }
}

export default async function GlobalVerificationLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const clientId = typeof params.client === "string" ? params.client : undefined;
  const type = typeof params.type === "string" ? params.type : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const search = typeof params.search === "string" ? params.search : undefined;

  const data = await getVerifications({ clientId, type, status, search });

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

      {!data ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            Could not reach the database, so the verification log cannot
            be loaded right now. This is a database connection issue, not
            a page issue.
          </p>
        </Card>
      ) : (
        <>
          <form
            method="GET"
            className="flex flex-wrap gap-3 items-end bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4"
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Search
              </label>
              <input
                type="text"
                name="search"
                defaultValue={search}
                placeholder="ID, name, reference..."
                className="h-9 w-52 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Client
              </label>
              <select
                name="client"
                defaultValue={clientId ?? ""}
                className="h-9 w-44 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
              >
                <option value="">All clients</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Type
              </label>
              <select
                name="type"
                defaultValue={type ?? ""}
                className="h-9 w-32 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
              >
                <option value="">All types</option>
                <option value="KYC">KYC</option>
                <option value="KYB">KYB</option>
                <option value="KYI">KYI</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Status
              </label>
              <select
                name="status"
                defaultValue={status ?? ""}
                className="h-9 w-40 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
              >
                <option value="">All statuses</option>
                <option value="STARTED">Started</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="ESCALATED">Escalated</option>
                <option value="EXPIRED">Expired</option>
              </select>
            </div>

            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium"
            >
              Apply
            </button>
            {(clientId || type || status || search) && (
              <a
                href="/internal-ops/verifications"
                className="h-9 flex items-center px-3 text-sm text-slate-500 dark:text-slate-400 hover:underline"
              >
                Clear
              </a>
            )}
          </form>

          <Card className="bg-card border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.verifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No verifications match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.verifications.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {v.caseId.slice(0, 14)}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {v.org.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{v.type}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {v.subjectName || v.subjectRef || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {v.sentinelScore != null ? v.sentinelScore.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusTone[v.status] ?? "secondary"}>
                          {v.status.replace("_", " ").toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(v.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}