import { fetchLogo, PdfReport, saveBytes, type Tone } from "./pdf-document";

// A report described as plain data (so a server page can build it and pass
// it to the download button), rendered with the PDF layout engine.

export type ReportBlock =
  | { kind: "rows"; rows: Array<[string, string | number | null]>; mono?: string[] }
  | { kind: "paragraph"; text: string; small?: boolean }
  | { kind: "subheading"; text: string }
  | { kind: "callout"; text: string; tone?: Tone; label?: string }
  | { kind: "bullets"; items: string[]; checkbox?: boolean }
  | { kind: "table"; headers: string[]; rows: Array<Array<string | number | null>>; widths: number[]; toneColumn?: number; tones?: Tone[] }
  | { kind: "card"; title: string; eyebrow?: string; tags: Array<{ label: string; tone: Tone }>; rows: Array<[string, string | number | null]>; mono?: string[] }
  | { kind: "signatures"; labels: string[] };

export type ReportSection = { heading: string; hint?: string; blocks: ReportBlock[] };

export type ReportSpec = {
  title: string; // "KYC Identity Report"
  reference: string;
  organization: string | null;
  eyebrow: string;
  subject: string;
  verdict: { label: string; tone: Tone };
  summary: string | null;
  facts: Array<[string, string]>;
  sections: ReportSection[];
  fileName: string;
};

export async function renderReportSpec(spec: ReportSpec, logo: Uint8Array | ArrayBuffer | null, generatedAt = Date.now()): Promise<Uint8Array> {
  const pdf = await PdfReport.create({ title: spec.title, reference: spec.reference, organization: spec.organization, generatedAt }, logo);
  pdf.titleBlock({ eyebrow: spec.eyebrow, title: spec.subject, verdict: spec.verdict, summary: spec.summary, facts: spec.facts });
  for (const section of spec.sections) {
    pdf.heading(section.heading, section.hint);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "rows":
          pdf.rows(block.rows, { mono: block.mono });
          break;
        case "paragraph":
          pdf.paragraph(block.text, { size: block.small ? 8.5 : 9 });
          break;
        case "subheading":
          pdf.subheading(block.text);
          break;
        case "callout":
          pdf.callout(block.text, block.tone ?? "neutral", block.label);
          break;
        case "bullets":
          pdf.bullets(block.items, { checkbox: block.checkbox });
          break;
        case "table":
          pdf.table(block.headers, block.rows, block.widths, { toneColumn: block.toneColumn, tones: block.tones });
          break;
        case "card":
          pdf.card(block.title, block.tags, block.rows, { eyebrow: block.eyebrow, mono: block.mono });
          break;
        case "signatures":
          pdf.signatureLines(block.labels);
          break;
      }
    }
  }
  return await pdf.save();
}

export async function downloadReportSpec(spec: ReportSpec): Promise<void> {
  saveBytes(await renderReportSpec(spec, await fetchLogo()), spec.fileName);
}

// Shared wording.
export const REVIEW_SIGNATURES: ReportBlock = { kind: "signatures", labels: ["Decision", "Reviewed by", "Date"] };

export function dateTime(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return (
    new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" }) + " EAT"
  );
}

export function checkTone(status: string): Tone {
  return status === "passed" || status === "pass" ? "green" : status === "failed" || status === "reject" ? "red" : status === "review" ? "amber" : "neutral";
}

export function checkLabel(status: string): string {
  return status === "passed" ? "Passed" : status === "failed" ? "Failed" : status === "not_applicable" ? "Not applicable" : status === "pass" ? "Passed" : status === "reject" ? "Rejected" : status === "review" ? "Needs review" : status === "unavailable" ? "Unavailable" : status;
}
