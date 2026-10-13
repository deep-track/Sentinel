"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { CreditCard, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { formatMoney } from "@/backend/convex/lib/pricing";

type Entry = {
  _id: string;
  createdAt: number;
  type: "allocation" | "deduction" | "refund" | "adjustment";
  credits: number;
  value: number | null;
  currency: "USD" | "KES" | null;
  reason: string;
  verificationId: string | null;
  reference: string | null;
  verificationType: string | null;
};

type Billing = {
  client: { name: string; plan: string; currency: "USD" | "KES" };
  balance: number;
  balanceValue: number;
  creditPrice: number;
  planBonus: number;
  prices: Array<{ service: string; label: string; credits: number; amount: number }>;
  entries: Entry[];
  nextCursor: number | null;
};

const TYPE_LABELS: Record<Entry["type"], string> = {
  allocation: "Credits added",
  deduction: "Charge",
  refund: "Refund",
  adjustment: "Adjustment",
};

const PLAN_NAMES: Record<string, string> = { trial: "Trial", starter: "Starter", growth: "Growth", business: "Business", enterprise: "Enterprise" };

// Where a charge's check can be opened.
function reportHref(entry: Entry): string | null {
  if (!entry.verificationId) return null;
  if (entry.verificationType === "aml") return `/aml-check/${entry.verificationId}`;
  if (entry.verificationType === "document") return `/idp/${entry.verificationId}`;
  if (entry.verificationType === "idp") return `/kyc/${entry.verificationId}`;
  return null;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function BillingView({ clientId }: { clientId: string }) {
  // Pages loaded so far; each later page uses the previous page's cursor.
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  useEffect(() => setCursors([undefined]), [clientId]);

  const first = useAuthedQuery(anyApi.creditLedger.billingForClient, { clientId, limit: 25 }) as Billing | null | undefined;

  if (first === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (first === null) {
    return <Card className="p-6 border-dashed text-sm text-muted-foreground">Billing details can&apos;t be loaded for this organization.</Card>;
  }

  const { client, balance, balanceValue, creditPrice, planBonus, prices } = first;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-6 bg-card border-border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Current plan</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{PLAN_NAMES[client.plan] ?? client.plan}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Billed in {client.currency} · 1 credit = {formatMoney(creditPrice, client.currency)}
                {planBonus ? ` · ${Math.round(planBonus * 100)}% plan bonus` : ""}
              </p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
          </div>
        </Card>
        <Card className="p-6 bg-card border-border">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Credit balance</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-semibold ${balance <= 0 ? "text-destructive" : "text-foreground"}`}>{balance.toLocaleString("en-US")}</span>
            <span className="text-sm text-muted-foreground">credits</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">worth {formatMoney(balanceValue, client.currency)}</p>
          {balance <= 0 ? <p className="mt-2 text-xs text-destructive">New verifications are refused until credits are added. Contact DeepTrack to top up.</p> : null}
        </Card>
      </div>

      <Card className="p-6 bg-card border-border">
        <p className="text-sm font-medium text-foreground">Your prices</p>
        <p className="text-xs text-muted-foreground">Per check, charged only when the check completes. AML monitoring is included in the screening price.</p>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {prices.map((row) => (
              <tr key={row.service} className="border-t">
                <td className="py-2 pr-2">{row.label}</td>
                <td className="py-2 pr-2 text-right text-muted-foreground">
                  {row.credits} credit{row.credits === 1 ? "" : "s"}
                </td>
                <td className="py-2 text-right font-medium">{formatMoney(row.amount, client.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-0 bg-card border-border overflow-hidden">
        <HistoryHeader clientId={clientId} currency={client.currency} pages={cursors} />
        <div className="divide-y">
          {cursors.map((cursor, index) => (
            <HistoryPage
              key={`${clientId}-${cursor ?? "first"}`}
              clientId={clientId}
              before={cursor}
              currency={client.currency}
              initial={index === 0 ? first : undefined}
              isLast={index === cursors.length - 1}
              onMore={(next) => setCursors((current) => [...current, next])}
            />
          ))}
        </div>
      </Card>
    </>
  );
}

function HistoryPage({
  clientId,
  before,
  currency,
  initial,
  isLast,
  onMore,
}: {
  clientId: string;
  before: number | undefined;
  currency: "USD" | "KES";
  initial?: Billing;
  isLast: boolean;
  onMore: (cursor: number) => void;
}) {
  const fetched = useAuthedQuery(anyApi.creditLedger.billingForClient, initial ? "skip" : { clientId, limit: 25, before }) as
    | Billing
    | null
    | undefined;
  const data = initial ?? fetched;
  if (data === undefined) return <div className="p-4"><Skeleton className="h-5 w-full" /></div>;
  if (!data) return null;
  if (data.entries.length === 0 && !before) return <p className="p-6 text-sm text-muted-foreground">No credit activity yet.</p>;
  return (
    <>
      {data.entries.map((entry) => {
        const href = reportHref(entry);
        return (
          <div key={entry._id} className="flex items-start justify-between gap-4 px-6 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {TYPE_LABELS[entry.type]}
                {entry.reference ? (
                  href ? (
                    <Link href={href} className="ml-2 font-mono text-xs text-primary hover:underline">
                      {entry.reference}
                    </Link>
                  ) : (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{entry.reference}</span>
                  )
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground break-words">{entry.reason}</p>
              <p className="text-xs text-muted-foreground">
                <ClientDate value={entry.createdAt} format="PPp" />
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`font-medium ${entry.credits < 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"}`}>
                {entry.credits > 0 ? "+" : ""}
                {entry.credits.toLocaleString("en-US")} credits
              </p>
              <p className="text-xs text-muted-foreground" title={entry.value === null ? "Recorded before currency pricing" : undefined}>
                {entry.value === null ? "—" : formatMoney(entry.value, entry.currency ?? currency)}
              </p>
            </div>
          </div>
        );
      })}
      {isLast && data.nextCursor !== null ? (
        <div className="p-4 text-center">
          <button type="button" onClick={() => onMore(data.nextCursor!)} className="rounded-lg border px-4 py-1.5 text-sm font-medium hover:bg-muted">
            Load more
          </button>
        </div>
      ) : null}
    </>
  );
}

// Header with a CSV export of up to the latest 100 entries.
function HistoryHeader({ clientId, currency, pages }: { clientId: string; currency: "USD" | "KES"; pages: Array<number | undefined> }) {
  const forExport = useAuthedQuery(anyApi.creditLedger.billingForClient, { clientId, limit: 100 }) as Billing | null | undefined;
  function download() {
    if (!forExport) return;
    const header = ["Date", "Type", "Credits", `Amount (${currency})`, "Scan ID", "Check type", "Description"];
    const rows = forExport.entries.map((entry) => [
      new Date(entry.createdAt).toISOString(),
      TYPE_LABELS[entry.type],
      entry.credits,
      entry.value ?? "",
      entry.reference,
      entry.verificationType,
      entry.reason,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sentinel-credit-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex items-center justify-between border-b px-6 py-4">
      <div>
        <p className="text-sm font-medium text-foreground">Credit history</p>
        <p className="text-xs text-muted-foreground">Every credit added, charged, refunded or adjusted, newest first{pages.length > 1 ? ` · ${pages.length} pages loaded` : ""}.</p>
      </div>
      <button
        type="button"
        onClick={download}
        disabled={!forExport || forExport.entries.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" /> CSV (latest 100)
      </button>
    </div>
  );
}
