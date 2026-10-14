"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// Hits cleared for a customer (amlCleared.listForClient), with Forget.

type Cleared = {
  _id: string;
  subjectName: string;
  identifiedBy: string;
  entityName: string;
  source: string;
  categories: string[];
  pepClass: number | null;
  clearedByName: string | null;
  reasonCode: string | null;
  clearedAt: number;
  suppressedCount: number;
  lastSuppressedAt: number | null;
  verificationId: string;
};

const SOURCE_LABELS: Record<string, string> = {
  OFAC_SDN: "OFAC SDN",
  UN_CONSOLIDATED: "UN list",
  EU_FSF: "EU list",
  UK_SANCTIONS: "UK list",
  OPENSANCTIONS: "OpenSanctions",
  ADVERSE_MEDIA: "Adverse media",
};

export function ClearedMatches({ clientId }: { clientId: string }) {
  const rows = useAuthedQuery(anyApi.amlCleared.listForClient, { clientId }) as Cleared[] | undefined;
  const forget = useMutation(anyApi.amlCleared.forget);
  if (rows === undefined) return null;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No cleared hits yet. They appear here when a reviewer approves an AML case.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3">Customer</th>
            <th className="p-3">Cleared hit</th>
            <th className="p-3">Cleared by</th>
            <th className="p-3 text-right">Not raised</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className="border-b last:border-0 align-top">
              <td className="p-3">
                <Link href={`/aml-check/${row.verificationId}`} className="font-medium hover:underline">
                  {row.subjectName}
                </Link>
                <p className="text-xs text-muted-foreground">identified by {row.identifiedBy}</p>
              </td>
              <td className="p-3">
                {row.entityName}
                <p className="text-xs text-muted-foreground">
                  {SOURCE_LABELS[row.source] ?? row.source} · {row.categories.join(", ")}
                  {row.pepClass ? ` · PEP Class ${row.pepClass}` : ""}
                </p>
              </td>
              <td className="p-3 text-muted-foreground">
                {row.clearedByName ?? "—"}
                <p className="text-xs">
                  <ClientDate value={row.clearedAt} format="PP" />
                  {row.reasonCode ? ` · ${row.reasonCode}` : ""}
                </p>
              </td>
              <td className="p-3 text-right text-muted-foreground">
                {row.suppressedCount}×
                {row.lastSuppressedAt ? (
                  <p className="text-xs">
                    last <ClientDate value={row.lastSuppressedAt} format="PP" />
                  </p>
                ) : null}
              </td>
              <td className="p-3 text-right">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!window.confirm(`Forget that ${row.entityName} was cleared for ${row.subjectName}? The next screening raises it again.`)) return;
                    forget({ clearedId: row._id }).then(
                      () => toast.success("Forgotten: it will be raised again"),
                      (error) => toast.error(getErrorMessage(error, "Only Reviewers and Admins can do that.")),
                    );
                  }}
                >
                  Forget
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
