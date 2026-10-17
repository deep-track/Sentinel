"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { CSV_TEMPLATE, RULE_LABELS, parseTransactionCsv, type RuleKey } from "@/backend/convex/lib/transactionRules";

type AlertRow = { _id: string; customerRef: string; rule: RuleKey; severity: "high" | "medium"; status: "open" | "closed" | "escalated"; summary: string; count: number; createdAt: number };
type UploadResult = { accepted: number; duplicates: number; rejected: Array<{ index: number; externalId: string | null; error: string }> };

const BATCH = 500;
const STATUSES = [
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Closed" },
] as const;

export function TransactionsView({ clientId, canUpload }: { clientId: string; canUpload: boolean }) {
  const [status, setStatus] = useState<"open" | "closed" | "escalated">("open");
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<UploadResult | null>(null);
  const data = useAuthedQuery(anyApi.transactions.alerts, { clientId, status }) as { open: number; rows: AlertRow[] } | undefined;
  const upload = useMutation(anyApi.transactions.upload);

  async function handleFile(file: File) {
    setUploading(true);
    setSummary(null);
    try {
      const rows = parseTransactionCsv(await file.text());
      if (!rows.length) throw new Error("The file has no transactions under its header row.");
      const total: UploadResult = { accepted: 0, duplicates: 0, rejected: [] };
      for (let start = 0; start < rows.length; start += BATCH) {
        const result = (await upload({ clientId, transactions: rows.slice(start, start + BATCH) })) as UploadResult;
        total.accepted += result.accepted;
        total.duplicates += result.duplicates;
        total.rejected.push(...result.rejected.map((item) => ({ ...item, index: item.index + start })));
      }
      setSummary(total);
      toast.success(`${total.accepted} transaction${total.accepted === 1 ? "" : "s"} added. Alerts appear within a minute.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "The file couldn't be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sentinel-transactions-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      {canUpload ? (
        <Card className="space-y-3 p-6">
          <p className="text-sm font-medium">Upload transactions</p>
          <p className="text-xs text-muted-foreground">
            CSV with the template&apos;s columns. Use your own customer id or the Sentinel reference of the customer&apos;s KYC or AML check as customerRef: with a
            Sentinel reference, high-risk customers are watched more closely. Re-uploading the same externalId is ignored.
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? "Uploading…" : "Choose CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Template
            </Button>
          </div>
          {summary ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p>
                {summary.accepted} added · {summary.duplicates} already uploaded · {summary.rejected.length} rejected
              </p>
              {summary.rejected.slice(0, 10).map((item) => (
                <p key={item.index} className="text-red-600">
                  Row {item.index + 2}
                  {item.externalId ? ` (${item.externalId})` : ""}: {item.error}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <p className="text-sm font-medium">
            Alerts {data ? <span className="text-muted-foreground">· {data.open} open</span> : null}
          </p>
          <div className="flex gap-2">
            {STATUSES.map((option) => (
              <Button key={option.value} size="sm" variant={status === option.value ? "default" : "outline"} onClick={() => setStatus(option.value)} aria-pressed={status === option.value}>
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="divide-y">
          {data === undefined ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
          {data?.rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No {status} alerts.</p> : null}
          {data?.rows.map((row) => (
            <Link key={row._id} href={`/transactions/alerts/${row._id}`} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {RULE_LABELS[row.rule]} <span className="text-muted-foreground">· {row.customerRef}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.summary}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={row.severity === "high" ? "destructive" : "secondary"}>{row.severity === "high" ? "High" : "Medium"}</Badge>
                {row.count} txn{row.count === 1 ? "" : "s"} · <ClientDate value={row.createdAt} format="PP" />
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
