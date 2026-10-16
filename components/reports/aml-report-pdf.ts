import { PEP_CLASS_LABELS, RISK_CATEGORIES, RISK_CATEGORY_LABELS } from "@/backend/convex/lib/amlCategories";
import { topics as TOPIC_LABELS } from "@/backend/lib/topics";
import {
  CHECKLIST,
  COVERAGE_STATUS,
  METHOD_LABELS,
  NEXT_STEPS,
  SOURCE_LABELS,
  categoryOf,
  matchStrength,
  reviewStatusLabel,
  type Match,
  type Report,
} from "./aml-report-content";
import { fetchLogo, pdfDateTime, PdfReport, saveBytes, type Tone } from "./pdf-document";

// The AML screening report as a PDF document (A4 portrait).

function verdictOf(verification: Report["verification"]): { label: string; tone: Tone } {
  if (verification.status === "failed") return { label: "Screening failed", tone: "red" };
  if (verification.status !== "completed") return { label: "In progress", tone: "neutral" };
  if (verification.verdict === "pass") return { label: "Clear", tone: "green" };
  if (verification.verdict === "reject") return { label: "Match - do not proceed", tone: "red" };
  return { label: "Needs review", tone: "amber" };
}

function matchRows(match: Match): Array<[string, unknown]> {
  if (match.source === "ADVERSE_MEDIA" && match.media) {
    return [
      ["Source", SOURCE_LABELS[match.source]],
      ["Published", [match.media.domain, match.media.publishedAt?.slice(0, 10)].filter(Boolean).join(" - ") || "-"],
      ["About this subject", match.media.aboutSubject === "yes" ? "Yes" : match.media.aboutSubject === "unclear" ? "Possibly - identity not confirmed" : "No"],
      ["Severity", match.media.severity],
      ["Risks reported", match.program || "-"],
      ["Summary", match.media.summary || "-"],
      ["Link", match.media.url],
    ];
  }
  const rows: Array<[string, unknown]> = [
    ["Source", SOURCE_LABELS[match.source] ?? match.source],
    ["Record id", match.sourceRecordId],
    ["Match strength", `${matchStrength(match)} - score ${match.matchScore} / 100`],
    ["How it matched", METHOD_LABELS[match.matchMethod] ?? match.matchMethod],
    [
      "Country",
      `${match.matchedCountry ?? "-"}${match.countryMatch && match.countryMatch !== "unknown" ? ` (${match.countryMatch === "match" ? "matches the subject" : "differs from the subject"})` : ""}`,
    ],
  ];
  if (match.birthDateMatch && match.birthDateMatch !== "unknown") rows.push(["Date of birth", match.birthDateMatch === "match" ? "Matches the subject" : "Differs from the subject - likely a different person"]);
  if (match.program && match.program !== "unknown") rows.push(["Programme / list", match.program]);
  if (match.topics?.length) rows.push(["Risk topics", match.topics.map((topic) => (TOPIC_LABELS as Record<string, string>)[topic] ?? topic).join(", ")]);
  if (match.datasets?.length) rows.push(["Datasets", match.datasets.join(", ")]);
  if (match.pepClass) {
    rows.push(["PEP class", `${PEP_CLASS_LABELS[match.pepClass]}${match.pepStatus === "former" ? " (former PEP)" : match.pepStatus === "current" ? " (currently in office)" : ""}`]);
  }
  if (match.pepPositions?.length) {
    rows.push(["Positions held", match.pepPositions.map((position) => `${position.title}${position.country ? ` (${position.country.toUpperCase()})` : ""}, ${position.startDate ?? "?"} to ${position.current ? "present" : position.endDate ?? "ended"}`).join("; ")]);
  }
  return rows;
}

export async function buildAmlReportPdf(report: Report, logo: Uint8Array | ArrayBuffer | null, generatedAt = Date.now()): Promise<Uint8Array> {
  const { verification, review, monitoring, clientName, organization } = report;
  const input = verification.input ?? {};
  const result = verification.result ?? {};
  const matches = result.matches ?? [];
  const coverage = result.coverage;
  const individual = input.entityType !== "entity";
  const verdict = verdictOf(verification);
  const pdf = await PdfReport.create({ title: "AML Screening Report", reference: verification.reference, organization: organization?.legalName ?? clientName, generatedAt }, logo);

  pdf.titleBlock({
    eyebrow: `AML screening report${organization?.legalName ?? clientName ? ` - ${organization?.legalName ?? clientName}` : ""}`,
    title: input.subjectName ?? "AML screening",
    verdict,
    summary: verification.failureReason ?? result.reason ?? null,
    facts: [
      ["Subject type", individual ? "Individual" : "Company / organisation"],
      ["Screened", pdfDateTime(verification.createdAt)],
      ["Completed", pdfDateTime(verification.completedAt)],
      ["Matches", String(matches.length)],
    ],
  });
  if (organization?.registrationNumber || organization?.regulator || organization?.complianceContact) {
    pdf.paragraph(
      [
        organization.legalName,
        organization.registrationNumber ? `Reg. no. ${organization.registrationNumber}` : null,
        organization.regulator ? `Regulated by ${organization.regulator}${organization.licenceNumber ? `, licence ${organization.licenceNumber}` : ""}` : null,
        organization.complianceContact ? `Compliance: ${organization.complianceContact}` : null,
      ]
        .filter(Boolean)
        .join("  ·  "),
      { size: 8, color: undefined },
    );
  }

  if (result.monitoring) {
    pdf.heading("Ongoing monitoring alert", "Raised by the daily re-screening of a monitored subject.");
    pdf.rows([
      ...(result.monitoring.added.length ? ([["New hits", result.monitoring.added.map((hit) => hit.entityName).join("; ")]] as Array<[string, unknown]>) : []),
      ...(result.monitoring.escalated.length ? ([["Hits now more severe", result.monitoring.escalated.map((hit) => hit.entityName).join("; ")]] as Array<[string, unknown]>) : []),
      ["Monitored subject", result.monitoring.reference],
      ...(result.monitoring.externalRef ? ([["Customer reference", result.monitoring.externalRef]] as Array<[string, unknown]>) : []),
    ]);
  }

  pdf.heading("Risk summary", "Hits by risk category. Each category with hits is explained under Findings, with what to do next.");
  const summaryRows = RISK_CATEGORIES.map((category) => {
    const hits = result.categories?.[category]?.hits ?? matches.filter((match) => categoryOf(match) === category).length;
    const pepClass = category === "pep" ? result.categories?.pep?.highestPepClass : null;
    return { label: RISK_CATEGORY_LABELS[category], value: hits > 0 ? `${hits} hit${hits === 1 ? "" : "s"}${pepClass ? `, highest Class ${pepClass}` : ""}` : "No hits", tone: (hits > 0 ? (category === "sanctions" ? "red" : "amber") : "green") as Tone };
  });
  pdf.table(["Category", "Result"], summaryRows.map((row) => [row.label, row.value]), [0.6, 0.4], { toneColumn: 1, tones: summaryRows.map((row) => row.tone) });

  pdf.heading("Subject screened");
  pdf.rows([
    ["Name", input.subjectName ?? "-"],
    ["Type", individual ? "Individual" : "Company or organisation"],
    ...(input.aliases?.length ? ([["Also known as", input.aliases.join("; ")]] as Array<[string, unknown]>) : []),
    ["Country", input.country ?? "-"],
    ...((individual
      ? [
          ["Date of birth", input.dateOfBirth ?? "Not provided"],
          ["Nationality", input.nationality ?? "Not provided"],
          ["ID or passport number", input.idNumber ?? "Not provided"],
        ]
      : [
          ["Registration number", input.registrationNumber ?? "Not provided"],
          ["Country of incorporation", input.jurisdiction ?? "Not provided"],
        ]) as Array<[string, unknown]>),
    ...(input.monitoring?.externalRef ? ([["Customer reference", input.monitoring.externalRef]] as Array<[string, unknown]>) : []),
  ]);
  if (individual && !input.dateOfBirth && !input.idNumber) {
    pdf.callout("No date of birth or ID number was given, so matches are on name and country only. Adding them rules out most look-alikes.", "amber", "Note");
  }

  if (result.suppressedMatches?.length) {
    pdf.heading("Previously cleared hits", "Left out of this result: a reviewer cleared them for this customer before, and they haven't become more severe.");
    pdf.table(
      ["Name", "Source", "Cleared"],
      result.suppressedMatches.map((hit) => [hit.entityName, SOURCE_LABELS[hit.source] ?? hit.source, `${pdfDateTime(hit.clearedAt, false)}${hit.clearedByName ? ` by ${hit.clearedByName}` : ""}${hit.reasonCode ? ` (${hit.reasonCode})` : ""}`]),
      [0.35, 0.35, 0.3],
    );
  }

  pdf.heading("Findings", matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"}, grouped by category.` : undefined);
  if (verification.status !== "completed") pdf.paragraph("Findings appear when the screening completes.");
  else if (matches.length === 0) pdf.paragraph("No matches were found on any source that was screened.", { size: 9.5 });
  else {
    for (const category of RISK_CATEGORIES) {
      const group = matches.filter((match) => categoryOf(match) === category);
      if (!group.length) continue;
      pdf.subheading(`${RISK_CATEGORY_LABELS[category]} (${group.length})`);
      pdf.callout(NEXT_STEPS[category], category === "sanctions" ? "red" : "amber", "What to do");
      for (const match of group) {
        pdf.card(
          match.entityName,
          [
            ...(match.categories ?? []).map((item) => ({ label: item === "pep" && match.pepClass ? `PEP Class ${match.pepClass}` : RISK_CATEGORY_LABELS[item], tone: (item === "sanctions" ? "red" : "amber") as Tone })),
            { label: `${match.riskLevel === "critical" ? "Critical" : "High"} risk`, tone: match.riskLevel === "critical" ? "red" : "amber" },
          ],
          matchRows(match),
          { eyebrow: `Match ${matches.indexOf(match) + 1}`, mono: ["Record id"] },
        );
      }
    }
  }

  pdf.heading("Review");
  if (review) {
    pdf.rows([
      ["Status", reviewStatusLabel(review)],
      ["Priority", review.priority.charAt(0).toUpperCase() + review.priority.slice(1)],
      ["Opened", pdfDateTime(review.createdAt)],
      ["Why it was held", review.triggerReason],
      ...(review.recommendation
        ? ([["Recommendation", `${review.recommendation.action === "approve" ? "Approve" : "Reject"}${review.recommendation.reasonCode ? ` (${review.recommendation.reasonCode})` : ""}${review.recommendation.byName ? ` by ${review.recommendation.byName}` : ""}, ${pdfDateTime(review.recommendation.at)}`]] as Array<[string, unknown]>)
        : []),
      ...(review.resolvedAt
        ? ([
            [
              "Resolved",
              `${pdfDateTime(review.resolvedAt)}${review.resolvedByName ? ` by ${review.resolvedByName}` : ""}${review.decisionSource === "client" ? " (your team)" : review.decisionSource === "deeptrack" ? " (DeepTrack)" : ""}${review.approvedByName && review.recommendation ? ", second approval under four-eyes" : ""}`,
            ],
          ] as Array<[string, unknown]>)
        : []),
      ...(review.reasonCode ? ([["Reason", review.reasonCode]] as Array<[string, unknown]>) : []),
      ...(review.resolutionNotes ? ([["Reviewer notes", review.resolutionNotes]] as Array<[string, unknown]>) : []),
    ]);
  } else {
    pdf.paragraph(verification.verdict === "pass" ? "No review was needed." : "No review item is recorded for this screening.");
  }
  if (verification.verdict && verification.verdict !== "pass") {
    pdf.subheading("Reviewer checklist");
    pdf.bullets(CHECKLIST, { checkbox: true });
    pdf.signatureLines(["Decision", "Reviewed by", "Date"]);
  }

  pdf.heading("Sources screened", "What this result is based on, and how fresh each source was.");
  pdf.table(
    ["Source", "Status"],
    [
      ...(coverage?.checkedSources ?? []).map((source) => [SOURCE_LABELS[source.sourceKey] ?? source.sourceKey, `${source.stale ? "Stale - " : "Screened - "}list downloaded ${pdfDateTime(source.fetchedAt)}`]),
      ...(coverage?.missingSources ?? []).map((source) => [SOURCE_LABELS[source] ?? source, "Not available at the time of screening"]),
      [SOURCE_LABELS.OPENSANCTIONS, COVERAGE_STATUS[coverage?.openSanctions ?? ""] ?? "-"],
      [SOURCE_LABELS.ADVERSE_MEDIA, `${COVERAGE_STATUS[coverage?.adverseMedia ?? ""] ?? "Not part of this screening"}${coverage?.adverseMedia === "screened" ? " (news from roughly the last 3 months)" : ""}`],
    ],
    [0.5, 0.5],
  );

  if (monitoring) {
    pdf.heading("Ongoing monitoring");
    pdf.rows([
      ["Status", monitoring.status === "active" ? "Active - re-screened daily" : "Stopped"],
      ["Monitored subject", monitoring.reference],
      ...(monitoring.externalRef ? ([["Customer reference", monitoring.externalRef]] as Array<[string, unknown]>) : []),
      ...(monitoring.lastScreenedAt ? ([["Last screened", pdfDateTime(monitoring.lastScreenedAt)]] as Array<[string, unknown]>) : []),
      ...(monitoring.nextScreenAt ? ([["Next screening", pdfDateTime(monitoring.nextScreenAt)]] as Array<[string, unknown]>) : []),
      ["Alerts raised", monitoring.alertCount],
    ]);
  }

  pdf.heading("Method and definitions");
  pdf.paragraph(
    "The subject is compared with Sentinel's copies of the OFAC SDN, UN Consolidated, EU and UK sanctions lists (refreshed daily) and with OpenSanctions' global sanctions, politically exposed person and risk data. Names are matched exactly, after normalisation, against aliases, and by similarity. A date of birth more than a year apart from a listed person's rules that person out for PEP and risk-list matches, and stops a sanctions match from being an automatic reject.",
    { size: 8.5 },
  );
  pdf.paragraph(
    "Adverse media searches recent news for the subject together with financial crime and misconduct terms (and, for Kenyan subjects, Kenyan official sources). An AI model reads each article and decides whether it is about this subject, how serious it is and what it reports. Only medium or high severity reporting counts.",
    { size: 8.5 },
  );
  pdf.paragraph("PEP classes:", { size: 8.5 });
  pdf.bullets(([1, 2, 3, 4] as const).map((pepClass) => PEP_CLASS_LABELS[pepClass]));
  pdf.paragraph("A match is a lead for review, not a finding of wrongdoing. Confirm identity and context before acting on it. This report reflects the sources as they were at the time of screening.", { size: 8.5 });

  return await pdf.save();
}

export async function downloadAmlReportPdf(report: Report): Promise<void> {
  const bytes = await buildAmlReportPdf(report, await fetchLogo());
  saveBytes(bytes, `AML-report-${report.verification.reference}.pdf`);
}
