"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvex, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { FileDown, FileWarning, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// Prepare an STR or SAR for the FRC (goAML) from a case, and see the ones
// already prepared for this check. Admins and Reviewers only.

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

export type StrSummary = {
  _id: string;
  reportCode: "STR" | "SAR";
  status: "draft" | "submitted";
  entityReference: string;
  frcReference: string | null;
  reason: string;
  createdByName: string | null;
  createdAt: number;
  submittedAt: number | null;
  verification: { _id: string; reference: string; type: string; subject: { kind: string; firstName?: string; lastName?: string; name?: string } } | null;
  reviewId: string | null;
};

export function subjectLabel(subject: { kind: string; firstName?: string; lastName?: string; name?: string }) {
  return subject.kind === "entity" ? subject.name ?? "" : [subject.firstName, subject.lastName].filter(Boolean).join(" ");
}

// Downloads a report's goAML XML.
export function useDownloadStr() {
  const convex = useConvex();
  return async (strId: string) => {
    try {
      const result = (await convex.query(anyApi.strReports.xml, { strId })) as { xml: string; fileName: string } | null;
      if (!result) throw new Error("not found");
      const url = URL.createObjectURL(new Blob([result.xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "The report couldn't be downloaded."));
    }
  };
}

export function MarkSubmittedButton({ strId }: { strId: string }) {
  const markSubmitted = useMutation(anyApi.strReports.markSubmitted);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        const frcReference = window.prompt("The reference goAML gave the submitted report:");
        if (!frcReference?.trim()) return;
        markSubmitted({ strId, frcReference }).then(
          () => toast.success("Marked as submitted to the FRC"),
          (error) => toast.error(getErrorMessage(error, "Couldn't save the reference.")),
        );
      }}
    >
      Mark submitted
    </Button>
  );
}

// The transaction fields of an STR, as the dialog edits them.
export type StrTransactionDraft = { number: string; date: string; amount: string; description: string; transmodeCode: string; counterpartyName: string; counterpartyAccount: string };

// What the dialog starts with, beyond the reason (e.g. from a transaction
// monitoring alert: an STR of its largest transaction).
export type StrPrefill = { reportCode?: "SAR" | "STR"; action?: string; transaction?: Partial<StrTransactionDraft>; transactionAlertId?: string };

const DEFAULT_ACTION = "Customer onboarding declined pending investigation; account placed under enhanced monitoring.";

export function StrPanel({ verificationId, reviewId, defaultReason, prefill }: { verificationId: string; reviewId?: string; defaultReason: string; prefill?: StrPrefill }) {
  const reports = useAuthedQuery(anyApi.strReports.forVerification, { verificationId }) as StrSummary[] | undefined;
  const download = useDownloadStr();
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Suspicious transaction report</h2>
          <p className="text-sm text-muted-foreground">Prepare an STR or SAR for the Financial Reporting Centre as a goAML file. Confidential: don&apos;t tell the customer (tipping-off).</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <FileWarning className="mr-1.5 h-4 w-4" /> Prepare STR
        </Button>
      </div>
      {reports?.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {reports.map((report) => (
            <li key={report._id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium">{report.reportCode}</span> <span className="font-mono text-xs">{report.entityReference}</span> · prepared{" "}
                <ClientDate value={report.createdAt} format="PP" />
                {report.createdByName ? ` by ${report.createdByName}` : ""} ·{" "}
                {report.status === "submitted" ? <span className="text-emerald-700">submitted ({report.frcReference})</span> : <span className="text-amber-700">draft, not yet submitted</span>}
              </span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void download(report._id)}>
                  <FileDown className="mr-1 h-3.5 w-3.5" /> goAML XML
                </Button>
                {report.status === "draft" ? <MarkSubmittedButton strId={report._id} /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        All STRs are on the <Link href="/reports" className="underline">Reports</Link> page.
      </p>
      {open ? <StrDialog verificationId={verificationId} reviewId={reviewId} defaultReason={defaultReason} prefill={prefill} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function StrDialog({ verificationId, reviewId, defaultReason, prefill, onClose }: { verificationId: string; reviewId?: string; defaultReason: string; prefill?: StrPrefill; onClose: () => void }) {
  const prepare = useMutation(anyApi.strReports.prepare);
  const download = useDownloadStr();
  const [reportCode, setReportCode] = useState<"SAR" | "STR">(prefill?.reportCode ?? "SAR");
  const [reason, setReason] = useState(defaultReason);
  const [action, setAction] = useState(prefill?.action ?? DEFAULT_ACTION);
  const [indicators, setIndicators] = useState("");
  const [transaction, setTransaction] = useState<StrTransactionDraft>({
    number: "",
    date: "",
    amount: "",
    description: "",
    transmodeCode: "",
    counterpartyName: "",
    counterpartyAccount: "",
    ...prefill?.transaction,
  });
  const [busy, setBusy] = useState(false);
  const setT = (key: keyof typeof transaction) => (event: React.ChangeEvent<HTMLInputElement>) => setTransaction((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = (await prepare({
        verificationId,
        ...(reviewId ? { reviewId } : {}),
        ...(prefill?.transactionAlertId ? { transactionAlertId: prefill.transactionAlertId } : {}),
        reportCode,
        reason,
        action,
        indicators: indicators.split(/[\n,]/),
        ...(reportCode === "STR"
          ? {
              transaction: {
                number: transaction.number,
                date: transaction.date ? new Date(transaction.date).getTime() : Date.now(),
                amount: Number(transaction.amount),
                description: transaction.description,
                transmodeCode: transaction.transmodeCode || undefined,
                counterpartyName: transaction.counterpartyName || undefined,
                counterpartyAccount: transaction.counterpartyAccount || undefined,
              },
            }
          : {}),
      })) as { strId: string; entityReference: string };
      toast.success(`${reportCode} ${result.entityReference} prepared`);
      await download(result.strId);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, "The report couldn't be prepared."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Prepare a report for the FRC</DialogTitle>
            <DialogDescription>
              Sentinel builds a goAML XML draft from this case and your organization profile. Check it against the FRC&apos;s current goAML guidance, add anything it needs, and submit it in goAML yourself. Then record the reference here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(["SAR", "STR"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setReportCode(code)}
                aria-pressed={reportCode === code}
                className={`rounded-lg border-2 p-3 text-left text-sm ${reportCode === code ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="font-medium">{code}</span>
                <span className="block text-xs text-muted-foreground">{code === "SAR" ? "Suspicious activity, no transaction (e.g. at onboarding)" : "A suspicious transaction"}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="str-reason" className="text-sm font-medium">
              Reason for suspicion
            </label>
            <textarea id="str-reason" rows={5} maxLength={4000} className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="str-action" className="text-sm font-medium">
              Action taken
            </label>
            <textarea id="str-action" rows={2} maxLength={1000} className={inputClass} value={action} onChange={(event) => setAction(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="str-indicators" className="text-sm font-medium">
              Indicator codes (optional)
            </label>
            <input id="str-indicators" className={inputClass} value={indicators} onChange={(event) => setIndicators(event.target.value)} placeholder="Codes from the FRC's goAML indicator list, comma separated" />
          </div>
          {reportCode === "STR" ? (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">The transaction</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label="Transaction number" className={inputClass} placeholder="Transaction number" value={transaction.number} onChange={setT("number")} required />
                <input aria-label="Transaction date" type="datetime-local" className={inputClass} value={transaction.date} onChange={setT("date")} required />
                <input aria-label="Amount" type="number" min="0.01" step="0.01" className={inputClass} placeholder="Amount (local currency)" value={transaction.amount} onChange={setT("amount")} required />
                <input aria-label="Transmode code" className={inputClass} placeholder="goAML transmode code (optional)" value={transaction.transmodeCode} onChange={setT("transmodeCode")} />
                <input aria-label="Counterparty name" className={inputClass} placeholder="Counterparty name (optional)" value={transaction.counterpartyName} onChange={setT("counterpartyName")} />
                <input aria-label="Counterparty account" className={inputClass} placeholder="Counterparty account (optional)" value={transaction.counterpartyAccount} onChange={setT("counterpartyAccount")} />
              </div>
              <input aria-label="Transaction description" className={inputClass} placeholder="What the transaction was" value={transaction.description} onChange={setT("description")} required />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              Prepare and download
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
