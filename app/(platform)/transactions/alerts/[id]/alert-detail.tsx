"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { CHANNEL_LABELS, RULE_LABELS, type Channel, type RuleKey } from "@/backend/convex/lib/transactionRules";

type Detail = {
  _id: string;
  customerRef: string;
  rule: RuleKey;
  severity: "high" | "medium";
  status: "open" | "closed" | "escalated";
  summary: string;
  createdAt: number;
  decidedAt?: number;
  decisionNotes?: string;
  customerCheck: { id: string; type: string } | null;
  transactions: Array<{ _id: string; externalId: string; occurredAt: number; amount: number; currency: string; direction: "in" | "out"; channel: Channel; counterpartyName: string | null; counterpartyCountry: string | null; narration: string | null }>;
};

const CHECK_PATHS: Record<string, string> = { idp: "/kyc", aml: "/aml-check", kyb: "/kyb", document: "/idp" };

export function AlertDetail({ alertId }: { alertId: string }) {
  const alert = useAuthedQuery(anyApi.transactions.alert, { alertId }) as Detail | null | undefined;
  const decide = useMutation(anyApi.transactions.decide);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"closed" | "escalated" | null>(null);

  if (alert === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (alert === null) return <p className="text-sm text-muted-foreground">Alert not found.</p>;

  async function submit(decision: "closed" | "escalated") {
    setSaving(decision);
    try {
      await decide({ alertId, decision, notes });
      toast.success(decision === "closed" ? "Alert closed." : "Alert escalated.");
      setNotes("");
    } catch (error) {
      toast.error(getErrorMessage(error, "The decision couldn't be saved."));
    } finally {
      setSaving(null);
    }
  }

  const checkPath = alert.customerCheck ? `${CHECK_PATHS[alert.customerCheck.type] ?? "/kyc"}/${alert.customerCheck.id}` : null;
  const total = (direction: "in" | "out") => alert.transactions.filter((txn) => txn.direction === direction).reduce((sum, txn) => sum + txn.amount, 0);

  return (
    <>
      <Link href="/transactions" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="mr-1 h-4 w-4" /> Transaction monitoring
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{RULE_LABELS[alert.rule]}</h1>
          <Badge variant={alert.severity === "high" ? "destructive" : "secondary"}>{alert.severity === "high" ? "High" : "Medium"}</Badge>
          <Badge variant="outline">{alert.status === "open" ? "Open" : alert.status === "closed" ? "Closed" : "Escalated"}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{alert.summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Customer {alert.customerRef} · raised <ClientDate value={alert.createdAt} format="PPp" />
          {checkPath ? (
            <>
              {" · "}
              <Link href={checkPath} className="underline">
                Open the customer&apos;s check
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Reference</th>
              <th className="p-3">In / out</th>
              <th className="p-3">Channel</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Counterparty</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {alert.transactions.map((txn) => (
              <tr key={txn._id}>
                <td className="whitespace-nowrap p-3">
                  <ClientDate value={txn.occurredAt} format="PPp" />
                </td>
                <td className="p-3">{txn.externalId}</td>
                <td className="p-3">{txn.direction === "in" ? "In" : "Out"}</td>
                <td className="p-3">{CHANNEL_LABELS[txn.channel]}</td>
                <td className="whitespace-nowrap p-3 text-right font-medium">
                  {txn.currency} {txn.amount.toLocaleString("en-US")}
                </td>
                <td className="p-3">
                  {txn.counterpartyName ?? "—"}
                  {txn.counterpartyCountry ? ` (${txn.counterpartyCountry})` : ""}
                  {txn.narration ? <span className="block text-xs text-muted-foreground">{txn.narration}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t p-3 text-xs text-muted-foreground">
          In: {total("in").toLocaleString("en-US")} · Out: {total("out").toLocaleString("en-US")} ({alert.transactions[0]?.currency ?? "KES"})
        </p>
      </Card>

      {alert.status === "open" ? (
        <Card className="space-y-3 p-6">
          <p className="text-sm font-medium">Decision</p>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="What you checked and why (at least 10 characters). E.g. the customer's business explains the cash deposits; source of funds documents on file."
            className="w-full rounded-md border bg-transparent p-3 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={saving !== null || notes.trim().length < 10} onClick={() => void submit("closed")}>
              {saving === "closed" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Close: not suspicious
            </Button>
            <Button variant="destructive" disabled={saving !== null || notes.trim().length < 10} onClick={() => void submit("escalated")}>
              {saving === "escalated" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Escalate as suspicious
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            To report it to the FRC, escalate, then file an STR from {checkPath ? "the customer's check" : "the customer's KYC or AML check"} (goAML export).
          </p>
        </Card>
      ) : (
        <Card className="p-6 text-sm">
          <p className="font-medium">{alert.status === "closed" ? "Closed as not suspicious" : "Escalated as suspicious"}</p>
          {alert.decidedAt ? (
            <p className="text-xs text-muted-foreground">
              <ClientDate value={alert.decidedAt} format="PPp" />
            </p>
          ) : null}
          {alert.decisionNotes ? <p className="mt-2 whitespace-pre-wrap">{alert.decisionNotes}</p> : null}
        </Card>
      )}
    </>
  );
}
