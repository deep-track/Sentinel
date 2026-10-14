"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { MarkSubmittedButton, subjectLabel, useDownloadStr, type StrSummary } from "@/components/reports/str-dialog";

type Pack = {
  month: string;
  period: { start: number; end: number };
  generatedAt: number;
  truncated: boolean;
  organization: { name: string; registrationNumber: string | null; regulator: string | null; licenceNumber: string | null; complianceContact: string | null; logoUrl: string | null };
  checks: { total: number; byProduct: Array<{ product: string; label: string; total: number; pass: number; review: number; reject: number; failed: number; pending: number }> };
  aml: { screenings: number; monitoringAlerts: number; monitoredSubjects: number; hits: Array<{ category: string; label: string; screenings: number }>; pepClasses: Record<string, number> };
  reviews: {
    opened: number;
    closed: number;
    approved: number;
    rejected: number;
    byTeam: number;
    byDeepTrack: number;
    fourEyes: number;
    medianHours: number | null;
    p90Hours: number | null;
    lateClosed: number;
    openAtEnd: number;
    overdueAtEnd: number;
    deciders: Array<{ name: string; approved: number; rejected: number }>;
    reasons: Array<{ reason: string; count: number }>;
  };
  strs: { prepared: number; submitted: number };
};

// The last 12 months, newest first, as YYYY-MM in Kenya time.
function recentMonths(): Array<{ value: string; label: string }> {
  const now = new Date(Date.now() + 3 * 3600_000);
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return {
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    };
  });
}

function hours(value: number | null) {
  if (value === null) return "—";
  return value < 48 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} days`;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ReportsView({ clientId, canSeeStrs }: { clientId: string; canSeeStrs: boolean }) {
  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(months[1]?.value ?? months[0].value);
  const pack = useAuthedQuery(anyApi.regulatorPack.forMonth, { clientId, month }) as Pack | null | undefined;
  const monthLabel = months.find((item) => item.value === month)?.label ?? month;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <select aria-label="Month" className="rounded-md border bg-background px-3 py-2 text-sm" value={month} onChange={(event) => setMonth(event.target.value)}>
          {months.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={() => window.print()} disabled={!pack}>
          <Download className="mr-1.5 h-4 w-4" /> Download (PDF)
        </Button>
      </div>

      {pack === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : pack === null ? null : (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Monthly AML / KYC compliance report</p>
                <h2 className="text-2xl font-bold">{monthLabel}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{pack.organization.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[pack.organization.registrationNumber && `Reg. no. ${pack.organization.registrationNumber}`, pack.organization.regulator && `Regulated by ${pack.organization.regulator}`, pack.organization.licenceNumber && `licence ${pack.organization.licenceNumber}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {pack.organization.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pack.organization.logoUrl} alt="" className="max-h-12 max-w-48 object-contain" />
              ) : null}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Period <ClientDate value={pack.period.start} format="PP" /> – <ClientDate value={pack.period.end - 1} format="PP" /> (East Africa Time) · generated <ClientDate value={pack.generatedAt} format="PPp" /> by Sentinel (DeepTrack)
              {pack.organization.complianceContact ? ` · compliance contact: ${pack.organization.complianceContact}` : ""}
            </p>
            {pack.truncated ? <p className="mt-2 text-xs text-amber-700">More than 5,000 checks this month: totals cover the first 5,000. Ask DeepTrack for a full export.</p> : null}
          </Card>

          <Card className="p-6 space-y-3">
            <h3 className="text-base font-semibold">Checks</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Checks run" value={pack.checks.total.toLocaleString("en-US")} hint="Test-key checks excluded" />
              <Stat label="AML screenings" value={pack.aml.screenings} />
              <Stat label="Monitoring alerts" value={pack.aml.monitoringAlerts} />
              <Stat label="Monitored customers" value={pack.aml.monitoredSubjects} hint="Now" />
            </div>
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Product</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Pass</th>
                  <th className="py-2 text-right">Review</th>
                  <th className="py-2 text-right">Reject</th>
                  <th className="py-2 text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {pack.checks.byProduct.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-muted-foreground">
                      No checks this month.
                    </td>
                  </tr>
                ) : (
                  pack.checks.byProduct.map((row) => (
                    <tr key={row.product} className="border-b last:border-0">
                      <td className="py-2">{row.label}</td>
                      <td className="py-2 text-right font-medium">{row.total}</td>
                      <td className="py-2 text-right">{row.pass}</td>
                      <td className="py-2 text-right">{row.review}</td>
                      <td className="py-2 text-right">{row.reject}</td>
                      <td className="py-2 text-right">{row.failed}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          <Card className="p-6 space-y-3">
            <h3 className="text-base font-semibold">AML hits</h3>
            <p className="text-sm text-muted-foreground">Screenings (including monitoring alerts) with at least one hit in each category.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {pack.aml.hits.map((hit) => (
                <div key={hit.category} className="flex justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{hit.label}</span>
                  <span className="font-medium">{hit.screenings}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              PEPs by highest class: Class 1 {pack.aml.pepClasses["1"]}, Class 2 {pack.aml.pepClasses["2"]}, Class 3 {pack.aml.pepClasses["3"]}, Class 4 {pack.aml.pepClasses["4"]}.
            </p>
          </Card>

          <Card className="p-6 space-y-3">
            <h3 className="text-base font-semibold">Reviews</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Opened" value={pack.reviews.opened} />
              <Stat label="Decided" value={pack.reviews.closed} hint={`${pack.reviews.approved} approved · ${pack.reviews.rejected} rejected`} />
              <Stat label="Median time to decide" value={hours(pack.reviews.medianHours)} hint={`90% within ${hours(pack.reviews.p90Hours)}`} />
              <Stat label="Open at month end" value={pack.reviews.openAtEnd} hint={`${pack.reviews.overdueAtEnd} past deadline`} />
            </div>
            <p className="text-sm text-muted-foreground">
              Decided by your team: {pack.reviews.byTeam}, by DeepTrack: {pack.reviews.byDeepTrack}. Four-eyes approvals: {pack.reviews.fourEyes}. Decided after their deadline: {pack.reviews.lateClosed}.
            </p>
            {pack.reviews.deciders.length ? (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2">Decided by</th>
                    <th className="py-2 text-right">Approved</th>
                    <th className="py-2 text-right">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.reviews.deciders.map((row) => (
                    <tr key={row.name} className="border-b last:border-0">
                      <td className="py-2">{row.name}</td>
                      <td className="py-2 text-right">{row.approved}</td>
                      <td className="py-2 text-right">{row.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {pack.reviews.reasons.length ? (
              <div>
                <p className="text-sm font-medium">Reasons given</p>
                <ul className="mt-1 text-sm text-muted-foreground">
                  {pack.reviews.reasons.map((row) => (
                    <li key={row.reason}>
                      {row.reason}: {row.count}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card className="p-6 space-y-2">
            <h3 className="text-base font-semibold">Suspicious transaction reports</h3>
            <p className="text-sm">
              Prepared: <span className="font-medium">{pack.strs.prepared}</span> · submitted to the FRC: <span className="font-medium">{pack.strs.submitted}</span>
            </p>
            <p className="text-xs text-muted-foreground">Counts only; the register is confidential.</p>
          </Card>

          <p className="text-xs text-muted-foreground">
            Produced by Sentinel from the organization&apos;s own checks and decisions. Figures reflect records at the time of generation.
          </p>
        </div>
      )}

      {canSeeStrs ? <StrRegister clientId={clientId} /> : null}
    </>
  );
}

function StrRegister({ clientId }: { clientId: string }) {
  const rows = useAuthedQuery(anyApi.strReports.list, { clientId }) as StrSummary[] | undefined;
  const download = useDownloadStr();
  return (
    <Card className="p-0 overflow-hidden print:hidden">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">STR register</h2>
        <p className="text-sm text-muted-foreground">Reports prepared for the Financial Reporting Centre. Confidential: Admins and Reviewers only. Prepare a new one from a case on the Reviews page.</p>
      </div>
      {rows === undefined ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No reports yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Report</th>
                <th className="p-3">Subject</th>
                <th className="p-3">Prepared</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id} className="border-b last:border-0 align-top">
                  <td className="p-3">
                    <span className="font-medium">{row.reportCode}</span>
                    <p className="font-mono text-xs text-muted-foreground">{row.entityReference}</p>
                  </td>
                  <td className="p-3">
                    {row.verification ? subjectLabel(row.verification.subject) : "—"}
                    {row.reviewId ? (
                      <p>
                        <Link href={`/reviews/${row.reviewId}`} className="text-xs text-primary hover:underline">
                          Open the case
                        </Link>
                      </p>
                    ) : null}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    <ClientDate value={row.createdAt} format="PP" />
                    {row.createdByName ? <p className="text-xs">{row.createdByName}</p> : null}
                  </td>
                  <td className="p-3">
                    {row.status === "submitted" ? (
                      <span className="text-emerald-700">
                        Submitted <ClientDate value={row.submittedAt!} format="PP" />
                        <p className="font-mono text-xs">{row.frcReference}</p>
                      </span>
                    ) : (
                      <span className="text-amber-700">Draft</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void download(row._id)}>
                        <FileDown className="mr-1 h-3.5 w-3.5" /> XML
                      </Button>
                      {row.status === "draft" ? <MarkSubmittedButton strId={row._id} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
