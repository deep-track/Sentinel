"use client";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, Download, FileJson, FileSpreadsheet, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { topics as TOPIC_LABELS } from "@/backend/lib/topics";
import {
  PEP_CLASS_LABELS,
  RISK_CATEGORIES,
  RISK_CATEGORY_LABELS,
  type PepClass,
  type RiskCategory,
} from "@/backend/convex/lib/amlCategories";

type PepPosition = { title: string; country: string | null; startDate: string | null; endDate: string | null; current: boolean };

type Match = {
  source: string;
  sourceRecordId: string;
  entityName: string;
  program: string;
  matchScore: number;
  matchMethod: string;
  matchedCountry?: string;
  countryMatch?: "match" | "mismatch" | "unknown";
  riskLevel: "critical" | "high";
  topics?: string[];
  datasets?: string[];
  categories?: RiskCategory[];
  pepClass?: PepClass;
  pepStatus?: "current" | "former" | "unknown";
  pepPositions?: PepPosition[];
  birthDateMatch?: "match" | "mismatch" | "unknown";
  media?: {
    url: string;
    title: string;
    domain: string | null;
    publishedAt: string | null;
    aboutSubject: "yes" | "no" | "unclear";
    severity: string;
    riskTypes: string[];
    summary: string;
  };
};

type Report = {
  verification: {
    _id: string;
    reference: string;
    status: "queued" | "processing" | "completed" | "failed";
    verdict?: "pass" | "review" | "reject";
    confidence?: number;
    creditsUsed: number;
    failureReason?: string;
    disputeReason?: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    input?: {
      subjectName?: string;
      entityType?: "individual" | "entity";
      country?: string | null;
      aliases?: string[];
      dateOfBirth?: string;
      nationality?: string;
      idNumber?: string;
      registrationNumber?: string;
      jurisdiction?: string;
      monitoring?: { subject?: string; externalRef?: string };
    } | null;
    result?: {
      reason?: string;
      matches?: Match[];
      // Hits left out because they were cleared for this customer before.
      suppressedMatches?: Array<{ source: string; sourceRecordId: string; entityName: string; clearedAt: number; clearedByName: string | null; reasonCode: string | null }>;
      categories?: Partial<Record<RiskCategory, { hits: number; highestPepClass?: PepClass | null }>>;
      coverage?: {
        checkedSources?: Array<{ sourceKey: string; fetchedAt: number; stale: boolean }>;
        missingSources?: string[];
        staleSources?: string[];
        openSanctions?: string | null;
        adverseMedia?: string | null;
      };
      monitoring?: {
        reference: string;
        externalRef?: string;
        added: Array<{ key: string; entityName: string; categories: RiskCategory[]; pepClass?: PepClass }>;
        escalated: Array<{ key: string; entityName: string; categories: RiskCategory[]; pepClass?: PepClass }>;
      };
    } | null;
  };
  clientName: string | null;
  organization?: {
    legalName: string | null;
    registrationNumber: string | null;
    regulator: string | null;
    licenceNumber: string | null;
    complianceContact: string | null;
    logoUrl: string | null;
  };
  review: {
    status: "pending" | "in_review" | "resolved";
    priority: "low" | "normal" | "high";
    triggerType: string;
    triggerReason: string;
    createdAt: number;
    resolutionAction: "confirm" | "keep_verdict" | "escalate" | null;
    resolutionNotes: string | null;
    resolvedAt: number | null;
    resolvedByName: string | null;
    reviewId?: string;
    decisionSource?: "client" | "deeptrack" | null;
    reasonCode?: string | null;
    recommendation?: { action: "approve" | "reject"; byName: string | null; reasonCode: string | null; at: number } | null;
    approvedByName?: string | null;
  } | null;
  monitoring: {
    reference: string;
    status: "active" | "removed";
    externalRef: string | null;
    enrolledHere: boolean;
    lastScreenedAt: number | null;
    nextScreenAt: number | null;
    alertCount: number;
    currentHits: number;
  } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  OFAC_SDN: "OFAC Specially Designated Nationals list (US Treasury)",
  UN_CONSOLIDATED: "UN Security Council Consolidated List",
  EU_FSF: "EU Consolidated Financial Sanctions List",
  UK_SANCTIONS: "UK Sanctions List (FCDO)",
  OPENSANCTIONS: "OpenSanctions (global sanctions, PEP and risk data)",
  ADVERSE_MEDIA: "Adverse media (news)",
  FBI_MOST_WANTED: "FBI Most Wanted",
};

const METHOD_LABELS: Record<string, string> = {
  exact: "Exact name match",
  normalized: "Name match after normalisation (case, accents, punctuation)",
  alias: "Match on a listed alias",
  fuzzy: "Similar name (fuzzy match)",
  provider_score: "OpenSanctions match score (name and identifiers)",
  ai_classification: "News article assessed by AI",
};

const COVERAGE_STATUS: Record<string, string> = {
  screened: "Screened",
  unavailable: "Unavailable at the time of screening",
  not_configured: "Not configured",
  disabled: "Turned off",
};

// What a reviewer should do for each kind of hit.
const NEXT_STEPS: Record<RiskCategory, string> = {
  sanctions:
    "Do not onboard or transact until this is resolved. Compare the full name, date of birth, nationality and identity documents with the listed entry. If it is the same person or entity, freeze the relationship and report it as your AML obligations require (in Kenya, to the Financial Reporting Centre).",
  pep:
    "Apply enhanced due diligence: senior management approval for the relationship, establish the source of wealth and source of funds, and apply enhanced ongoing monitoring. Class 1 and 2 PEPs are usually the highest risk; former PEPs remain in scope for a risk-based period after leaving office.",
  special_interest:
    "Read the listing to understand why the subject is of interest (criminal proceedings, wanted notice, person of interest). Confirm whether it is the same subject and record how it affects their risk rating.",
  fitness_probity:
    "Check whether the disqualification, debarment or regulatory action is current and what it covers. For directors, officers or key persons, assess whether they remain fit and proper for their role.",
  adverse_media:
    "Read each article. Confirm it is about the same subject, judge how credible and recent the reporting is, and record whether it changes the subject's risk rating.",
  insolvency:
    "Confirm the insolvency or bankruptcy record relates to the subject and whether it is ongoing, and consider the credit and fraud risk it implies.",
};

const CHECKLIST = [
  "Compared the subject's identifiers (date of birth, nationality, ID or registration number) with every match",
  "Decided for each match whether it is the same subject, and recorded why",
  "Applied the required due diligence for each confirmed category",
  "Recorded the final risk rating and decision, with approver name and date",
  "Filed a suspicious transaction report if required",
];

function verdictLabel(report: Report["verification"]) {
  if (report.status === "failed") return { label: "Screening failed", tone: "border-red-300 bg-red-50 text-red-700" };
  if (report.status !== "completed") return { label: "Screening in progress", tone: "border-slate-300 bg-slate-50 text-slate-600" };
  if (report.verdict === "pass") return { label: "Clear", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" };
  if (report.verdict === "reject") return { label: "Match — do not proceed", tone: "border-red-300 bg-red-50 text-red-700" };
  return { label: "Needs review", tone: "border-amber-300 bg-amber-50 text-amber-800" };
}

function reviewStatusLabel(review: NonNullable<Report["review"]>) {
  if (review.status === "resolved") {
    if (review.resolutionAction === "confirm") return "Resolved — the match was a false positive (cleared)";
    if (review.resolutionAction === "keep_verdict") return "Resolved — the match was confirmed";
    return "Resolved";
  }
  if (review.recommendation) return "Awaiting second approval (four-eyes)";
  return review.status === "in_review" ? "Escalated — under investigation" : "Awaiting review";
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 break-inside-avoid-page dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 text-sm last:border-0 sm:grid-cols-[200px_1fr] dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="break-words text-slate-900 dark:text-slate-100">{children}</span>
    </div>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "red" | "amber" | "green" }) {
  const tones = {
    slate: "border-slate-300 text-slate-700 dark:text-slate-300",
    red: "border-red-300 text-red-700",
    amber: "border-amber-300 text-amber-800",
    green: "border-emerald-300 text-emerald-700",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

function matchStrength(match: Match): string {
  if (match.source === "ADVERSE_MEDIA") return match.media?.severity === "high" ? "High severity" : "Medium severity";
  if (match.matchScore >= 94) return "Strong";
  if (match.matchScore >= 85) return "Close";
  return "Possible";
}

function categoryOf(match: Match): RiskCategory {
  return match.categories?.[0] ?? "sanctions";
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function matchesCsv(matches: Match[]): string {
  const header = ["Category", "PEP class", "Name / headline", "Source", "Record id / URL", "Score", "Method", "Country", "Country check", "Date of birth check", "Risk level", "Topics / risk types", "Summary"];
  const rows = matches.map((match) => [
    (match.categories ?? []).map((category) => RISK_CATEGORY_LABELS[category]),
    match.pepClass ?? "",
    match.entityName,
    SOURCE_LABELS[match.source] ?? match.source,
    match.media?.url ?? match.sourceRecordId,
    match.matchScore,
    METHOD_LABELS[match.matchMethod] ?? match.matchMethod,
    match.matchedCountry ?? "",
    match.countryMatch ?? "",
    match.birthDateMatch ?? "",
    match.riskLevel,
    match.media?.riskTypes ?? match.topics ?? [],
    match.media?.summary ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function MatchCard({ match, index }: { match: Match; index: number }) {
  const isMedia = match.source === "ADVERSE_MEDIA";
  return (
    <div className="rounded-xl border border-slate-200 p-4 break-inside-avoid dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Match {index + 1}</p>
          {isMedia && match.media ? (
            <a href={match.media.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">
              {match.entityName}
              <ExternalLink className="ml-1 inline h-3 w-3 print:hidden" aria-hidden="true" />
            </a>
          ) : (
            <p className="font-semibold text-slate-900 dark:text-white">{match.entityName}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {(match.categories ?? []).map((category) => (
            <Pill key={category} tone={category === "sanctions" ? "red" : "amber"}>
              {category === "pep" && match.pepClass ? `PEP Class ${match.pepClass}` : RISK_CATEGORY_LABELS[category]}
            </Pill>
          ))}
          <Pill tone={match.riskLevel === "critical" ? "red" : "amber"}>{match.riskLevel === "critical" ? "Critical" : "High"} risk</Pill>
        </div>
      </div>

      <div className="mt-3">
        <Row label="Source">{SOURCE_LABELS[match.source] ?? match.source}</Row>
        {isMedia && match.media ? (
          <>
            <Row label="Published">
              {[match.media.domain, match.media.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ") || "—"}
            </Row>
            <Row label="About this subject">
              {match.media.aboutSubject === "yes" ? "Yes" : match.media.aboutSubject === "unclear" ? "Possibly — identity not confirmed" : "No"}
            </Row>
            <Row label="Severity">{match.media.severity}</Row>
            <Row label="Risks reported">{match.program || "—"}</Row>
            <Row label="Summary">{match.media.summary || "—"}</Row>
            <Row label="Link">
              <span className="break-all text-xs">{match.media.url}</span>
            </Row>
          </>
        ) : (
          <>
            <Row label="Record id">
              {match.source === "OPENSANCTIONS" ? (
                <Link href={`/aml/profile/${encodeURIComponent(match.sourceRecordId)}`} className="font-mono text-xs text-blue-700 hover:underline">
                  {match.sourceRecordId}
                </Link>
              ) : (
                <span className="font-mono text-xs">{match.sourceRecordId}</span>
              )}
            </Row>
            <Row label="Match strength">
              {matchStrength(match)} — score {match.matchScore} / 100
            </Row>
            <Row label="How it matched">{METHOD_LABELS[match.matchMethod] ?? match.matchMethod}</Row>
            <Row label="Country">
              {match.matchedCountry ?? "—"}
              {match.countryMatch && match.countryMatch !== "unknown" ? ` (${match.countryMatch === "match" ? "matches the subject" : "differs from the subject"})` : ""}
            </Row>
            {match.birthDateMatch && match.birthDateMatch !== "unknown" ? (
              <Row label="Date of birth">{match.birthDateMatch === "match" ? "Matches the subject" : "Differs from the subject — likely a different person"}</Row>
            ) : null}
            {match.program && match.program !== "unknown" ? <Row label="Programme / list">{match.program}</Row> : null}
            {match.topics?.length ? (
              <Row label="Risk topics">
                {match.topics.map((topic) => (TOPIC_LABELS as Record<string, string>)[topic] ?? topic).join(", ")}
              </Row>
            ) : null}
            {match.datasets?.length ? <Row label="Datasets">{match.datasets.join(", ")}</Row> : null}
            {match.pepClass ? (
              <Row label="PEP class">
                {PEP_CLASS_LABELS[match.pepClass]}
                {match.pepStatus === "former" ? " (former PEP — no current position)" : match.pepStatus === "current" ? " (currently in office)" : ""}
              </Row>
            ) : null}
          </>
        )}
      </div>

      {match.pepPositions?.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">Positions held</p>
          <table className="mt-1 w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Position</th>
                <th className="py-1 pr-2 font-medium">Country</th>
                <th className="py-1 pr-2 font-medium">From</th>
                <th className="py-1 pr-2 font-medium">To</th>
              </tr>
            </thead>
            <tbody>
              {match.pepPositions.map((position, positionIndex) => (
                <tr key={positionIndex} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2">{position.title}</td>
                  <td className="py-1 pr-2 uppercase">{position.country ?? "—"}</td>
                  <td className="py-1 pr-2">{position.startDate ?? "—"}</td>
                  <td className="py-1 pr-2">{position.current ? "Current" : position.endDate ?? "Ended"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function AmlReport({ verificationId }: { verificationId: string }) {
  const report = useAuthedQuery(anyApi.amlReport.forClient, { verificationId }) as Report | null | undefined;

  if (report === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (report === null) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">
        This screening doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }

  const { verification, review, monitoring, clientName, organization } = report;
  const input = verification.input ?? {};
  const result = verification.result ?? {};
  const matches = result.matches ?? [];
  const coverage = result.coverage;
  const verdict = verdictLabel(verification);
  const individual = input.entityType !== "entity";
  const byCategory = RISK_CATEGORIES.map((category) => ({
    category,
    matches: matches.filter((match) => categoryOf(match) === category),
    summary: result.categories?.[category],
  }));
  const foundCategories = byCategory.filter((group) => group.matches.length > 0);
  const generatedAt = Date.now();
  const fileBase = `aml-report-${verification.reference}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/aml-check" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" /> Back to AML screening
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Download className="mr-2 h-4 w-4" /> Download report (PDF)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadFile(`${fileBase}-matches.csv`, matchesCsv(matches), "text/csv;charset=utf-8")}
            disabled={matches.length === 0}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Matches (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              downloadFile(
                `${fileBase}.json`,
                JSON.stringify({ generatedAt: new Date(generatedAt).toISOString(), ...report }, null, 2),
                "application/json",
              )
            }
          >
            <FileJson className="mr-2 h-4 w-4" /> Evidence (JSON)
          </Button>
        </div>
      </div>

      <header className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        {organization?.logoUrl || organization?.legalName ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
            {organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={organization.logoUrl} alt={`${organization.legalName ?? clientName ?? "Organization"} logo`} className="max-h-12 max-w-48 object-contain" />
            ) : (
              <span />
            )}
            <div className="text-right text-xs text-slate-500">
              {organization.legalName ? <p className="font-medium text-slate-700 dark:text-slate-300">{organization.legalName}</p> : null}
              {organization.registrationNumber ? <p>Reg. no. {organization.registrationNumber}</p> : null}
              {organization.regulator ? (
                <p>
                  Regulated by {organization.regulator}
                  {organization.licenceNumber ? ` · licence ${organization.licenceNumber}` : ""}
                </p>
              ) : null}
              {organization.complianceContact ? <p>Compliance: {organization.complianceContact}</p> : null}
            </div>
          </div>
        ) : null}
        <p className="text-xs uppercase tracking-wide text-slate-500">AML screening report{clientName ? ` · ${clientName}` : ""}</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{input.subjectName ?? "AML screening"}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{verification.reference}</p>
          </div>
          <span className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${verdict.tone}`}>{verdict.label}</span>
        </div>
        {result.reason ? <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">{result.reason}</p> : null}
        {verification.failureReason ? <p className="mt-4 text-sm text-red-700">{verification.failureReason}</p> : null}
        <p className="mt-4 text-xs text-slate-500">
          Screened <ClientDate value={verification.createdAt} format="PPpp" />
          {verification.completedAt ? (
            <>
              {" "}· completed <ClientDate value={verification.completedAt} format="PPpp" />
            </>
          ) : null}{" "}
          · report generated <ClientDate value={generatedAt} format="PPpp" />
        </p>
      </header>

      {result.monitoring ? (
        <Section title="Ongoing monitoring alert" hint="This result was raised by the daily re-screening of a monitored subject.">
          {result.monitoring.added.length ? (
            <Row label="New hits">
              {result.monitoring.added.map((hit) => hit.entityName).join("; ")}
            </Row>
          ) : null}
          {result.monitoring.escalated.length ? (
            <Row label="Hits now more severe">
              {result.monitoring.escalated.map((hit) => hit.entityName).join("; ")}
            </Row>
          ) : null}
          <Row label="Monitored subject">{result.monitoring.reference}</Row>
          {result.monitoring.externalRef ? <Row label="Customer reference">{result.monitoring.externalRef}</Row> : null}
        </Section>
      ) : null}

      <Section title="Risk summary" hint="Hits by category. Each category is explained, with what to do next, under Findings.">
        <div className="grid gap-2 sm:grid-cols-2">
          {byCategory.map(({ category, matches: categoryMatches, summary }) => {
            const hits = summary?.hits ?? categoryMatches.length;
            const pepClass = category === "pep" ? summary?.highestPepClass : null;
            return (
              <div key={category} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span>{RISK_CATEGORY_LABELS[category]}</span>
                <span className={hits > 0 ? "font-semibold text-amber-800" : "text-emerald-700"}>
                  {hits > 0 ? `${hits} hit${hits === 1 ? "" : "s"}${pepClass ? ` · Class ${pepClass}` : ""}` : "No hits"}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Subject screened">
        <Row label="Name">{input.subjectName ?? "—"}</Row>
        <Row label="Type">{individual ? "Individual" : "Company or organisation"}</Row>
        {input.aliases?.length ? <Row label="Also known as">{input.aliases.join("; ")}</Row> : null}
        <Row label="Country">{input.country ?? "—"}</Row>
        {individual ? (
          <>
            <Row label="Date of birth">{input.dateOfBirth ?? "Not provided"}</Row>
            <Row label="Nationality">{input.nationality ?? "Not provided"}</Row>
            <Row label="ID or passport number">{input.idNumber ?? "Not provided"}</Row>
          </>
        ) : (
          <>
            <Row label="Registration number">{input.registrationNumber ?? "Not provided"}</Row>
            <Row label="Country of incorporation">{input.jurisdiction ?? "Not provided"}</Row>
          </>
        )}
        {input.monitoring?.externalRef ? <Row label="Customer reference">{input.monitoring.externalRef}</Row> : null}
        {individual && !input.dateOfBirth && !input.idNumber ? (
          <p className="mt-3 text-xs text-amber-800">
            No date of birth or ID number was given, so matches are on name and country only. Adding them rules out most look-alikes.
          </p>
        ) : null}
      </Section>

      {result.suppressedMatches?.length ? (
        <Section title="Previously cleared hits" hint="Left out of this result: a reviewer cleared them for this customer before, and they haven't become more severe.">
          {result.suppressedMatches.map((hit) => (
            <Row key={`${hit.source}:${hit.sourceRecordId}`} label={hit.entityName}>
              {SOURCE_LABELS[hit.source] ?? hit.source} · cleared <ClientDate value={hit.clearedAt} format="PP" />
              {hit.clearedByName ? ` by ${hit.clearedByName}` : ""}
              {hit.reasonCode ? ` (${hit.reasonCode})` : ""}
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title="Findings" hint={matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"}, grouped by category.` : undefined}>
        {verification.status !== "completed" ? (
          <p className="text-sm text-slate-500">Findings appear when the screening completes.</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-emerald-700">No matches were found on any source that was screened.</p>
        ) : (
          <div className="space-y-6">
            {foundCategories.map(({ category, matches: categoryMatches }) => (
              <div key={category} className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {RISK_CATEGORY_LABELS[category]} · {categoryMatches.length}
                </h3>
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <span className="font-semibold">What to do: </span>
                  {NEXT_STEPS[category]}
                </p>
                {categoryMatches.map((match) => (
                  <MatchCard key={`${match.source}:${match.sourceRecordId}`} match={match} index={matches.indexOf(match)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Review" hint="Manual review of this result.">
        {review ? (
          <>
            <Row label="Status">{reviewStatusLabel(review)}</Row>
            <Row label="Priority">{review.priority}</Row>
            <Row label="Opened">
              <ClientDate value={review.createdAt} format="PPpp" />
            </Row>
            <Row label="Why it was held">{review.triggerReason}</Row>
            {review.recommendation ? (
              <Row label="Recommendation">
                {review.recommendation.action === "approve" ? "Approve" : "Reject"}
                {review.recommendation.reasonCode ? ` (${review.recommendation.reasonCode})` : ""}
                {review.recommendation.byName ? ` by ${review.recommendation.byName}` : ""} · <ClientDate value={review.recommendation.at} format="PPpp" />
              </Row>
            ) : null}
            {review.resolvedAt ? (
              <Row label="Resolved">
                <ClientDate value={review.resolvedAt} format="PPpp" />
                {review.resolvedByName ? ` by ${review.resolvedByName}` : ""}
                {review.decisionSource === "client" ? " (your team)" : review.decisionSource === "deeptrack" ? " (DeepTrack)" : ""}
                {review.approvedByName && review.recommendation ? ", second approval under four-eyes" : ""}
              </Row>
            ) : null}
            {review.reasonCode ? <Row label="Reason">{review.reasonCode}</Row> : null}
            {review.resolutionNotes ? <Row label="Reviewer notes">{review.resolutionNotes}</Row> : null}
            {review.reviewId && review.status !== "resolved" ? (
              <p className="mt-3 print:hidden">
                <Link href={`/reviews/${review.reviewId}`} className="text-sm font-medium text-primary hover:underline">
                  Open the case to decide it →
                </Link>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {verification.verdict === "pass" ? "No review was needed." : "No review item is recorded for this screening."}
          </p>
        )}
        {verification.verdict && verification.verdict !== "pass" ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">Reviewer checklist</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded border border-slate-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              {["Decision", "Reviewed by", "Date"].map((label) => (
                <div key={label}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <div className="mt-6 border-b border-slate-400" />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Sources screened" hint="What this result is based on, and how fresh each source was.">
        {(coverage?.checkedSources ?? []).map((source) => (
          <Row key={source.sourceKey} label={SOURCE_LABELS[source.sourceKey] ?? source.sourceKey}>
            {source.stale ? "Stale — " : "Screened — "}list downloaded <ClientDate value={source.fetchedAt} format="PPp" />
          </Row>
        ))}
        {(coverage?.missingSources ?? []).map((source) => (
          <Row key={source} label={SOURCE_LABELS[source] ?? source}>
            Not available at the time of screening
          </Row>
        ))}
        <Row label={SOURCE_LABELS.OPENSANCTIONS}>{COVERAGE_STATUS[coverage?.openSanctions ?? ""] ?? "—"}</Row>
        <Row label={SOURCE_LABELS.ADVERSE_MEDIA}>
          {COVERAGE_STATUS[coverage?.adverseMedia ?? ""] ?? "Not part of this screening"}
          {coverage?.adverseMedia === "screened" ? " (news from roughly the last 3 months)" : ""}
        </Row>
      </Section>

      {monitoring ? (
        <Section title="Ongoing monitoring">
          <Row label="Status">{monitoring.status === "active" ? "Active — re-screened daily" : "Stopped"}</Row>
          <Row label="Monitored subject">{monitoring.reference}</Row>
          {monitoring.externalRef ? <Row label="Customer reference">{monitoring.externalRef}</Row> : null}
          {monitoring.lastScreenedAt ? (
            <Row label="Last screened">
              <ClientDate value={monitoring.lastScreenedAt} format="PPpp" />
            </Row>
          ) : null}
          {monitoring.nextScreenAt ? (
            <Row label="Next screening">
              <ClientDate value={monitoring.nextScreenAt} format="PPpp" />
            </Row>
          ) : null}
          <Row label="Alerts raised">{monitoring.alertCount}</Row>
        </Section>
      ) : null}

      <Section title="Method and definitions">
        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
          <p>
            The subject is compared with Sentinel&apos;s copies of the OFAC SDN and UN Consolidated lists (refreshed daily) and with
            OpenSanctions&apos; global sanctions, politically exposed person and risk data. Names are matched exactly, after
            normalisation, against aliases, and by similarity. A date of birth more than a year apart from a listed person&apos;s rules
            that person out for PEP and risk-list matches, and stops a sanctions match from being an automatic reject.
          </p>
          <p>
            Adverse media searches recent news for the subject together with financial crime and misconduct terms. An AI model
            reads each article and decides whether it is about this subject, how serious it is and what it reports. Only medium or
            high severity reporting counts.
          </p>
          <p>PEP classes:</p>
          <ul className="list-disc pl-5">
            {([1, 2, 3, 4] as const).map((pepClass) => (
              <li key={pepClass}>{PEP_CLASS_LABELS[pepClass]}</li>
            ))}
          </ul>
          <p>
            A match is a lead for review, not a finding of wrongdoing. Confirm identity and context before acting on it. This report
            reflects the sources as they were at the time of screening.
          </p>
        </div>
      </Section>
    </div>
  );
}
