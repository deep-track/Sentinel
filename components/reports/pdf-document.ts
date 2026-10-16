import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

// A small flowing-layout engine for Sentinel's PDF reports (A4 portrait), in a clean document style without rules or boxes:
// DeepTrack logo and report title on every page, a confidential footer with
// page numbers, and blocks (headings, label/value rows, paragraphs, lists,
// tables, callouts) that break across pages cleanly. Built in the browser
// with pdf-lib; Helvetica only, so text is reduced to Latin-1 (pdfText).

export const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const HEADER_HEIGHT = 58;
const FOOTER_HEIGHT = 44;

export const COLORS = {
  brand: rgb(5 / 255, 149 / 255, 221 / 255),
  ink: rgb(0.09, 0.11, 0.15),
  muted: rgb(0.42, 0.45, 0.5),
  line: rgb(0.87, 0.89, 0.92),
  soft: rgb(0.96, 0.97, 0.98),
  green: rgb(0.02, 0.55, 0.38),
  greenSoft: rgb(0.9, 0.97, 0.93),
  amber: rgb(0.7, 0.42, 0.02),
  amberSoft: rgb(1, 0.96, 0.88),
  red: rgb(0.75, 0.13, 0.13),
  redSoft: rgb(0.99, 0.91, 0.91),
};
export type Tone = "green" | "amber" | "red" | "neutral";
const TONES: Record<Tone, { fg: RGB; bg: RGB }> = {
  green: { fg: COLORS.green, bg: COLORS.greenSoft },
  amber: { fg: COLORS.amber, bg: COLORS.amberSoft },
  red: { fg: COLORS.red, bg: COLORS.redSoft },
  neutral: { fg: COLORS.muted, bg: COLORS.soft },
};

// Helvetica (WinAnsi) can't draw every character: keep Latin-1, replace the rest.
export function pdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/\t/g, " ")
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "?");
}

export function pdfDateTime(value: number | null | undefined, withTime = true): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "Africa/Nairobi",
  }) + (withTime ? " EAT" : "");
}

export type ReportMeta = {
  title: string; // e.g. "AML Screening Report"
  reference: string;
  organization: string | null; // the client, shown in the footer
  generatedAt: number;
};

export class PdfReport {
  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
    private readonly meta: ReportMeta,
    private readonly logo: PDFImage | null,
  ) {}

  page!: PDFPage;
  y = 0;
  readonly left = MARGIN;
  readonly right = A4.width - MARGIN;
  readonly width = A4.width - MARGIN * 2;

  static async create(meta: ReportMeta, logoPng?: Uint8Array | ArrayBuffer | null): Promise<PdfReport> {
    const doc = await PDFDocument.create();
    doc.setTitle(`${meta.title} ${meta.reference}`);
    doc.setAuthor("DeepTrack Sentinel");
    doc.setCreator("Sentinel by DeepTrack");
    doc.setSubject(meta.title);
    let logo: PDFImage | null = null;
    if (logoPng) {
      try {
        logo = await doc.embedPng(logoPng);
      } catch {
        logo = null;
      }
    }
    const report = new PdfReport(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), await doc.embedFont(StandardFonts.Courier), meta, logo);
    report.newPage();
    return report;
  }

  // ── Low-level drawing ────────────────────────────────────────────────────

  text(value: unknown, x: number, y: number, options: { size?: number; font?: PDFFont; color?: RGB; align?: "left" | "right" | "center" } = {}) {
    const size = options.size ?? 9.5;
    const font = options.font ?? this.regular;
    const safe = pdfText(value);
    const width = font.widthOfTextAtSize(safe, size);
    const drawX = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    this.page.drawText(safe, { x: drawX, y, size, font, color: options.color ?? COLORS.ink });
  }

  wrap(value: unknown, width: number, size = 9.5, font: PDFFont = this.regular): string[] {
    const lines: string[] = [];
    for (const paragraph of pdfText(value).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        // Very long tokens (URLs, ids) are split by characters.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
          if (line) {
            lines.push(line);
            line = "";
          }
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        const next = line ? `${line} ${rest}` : rest;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          lines.push(line);
          line = rest;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    const top = A4.height - 30;
    if (this.logo) {
      const scale = 96 / this.logo.width;
      this.page.drawImage(this.logo, { x: this.left, y: top - this.logo.height * scale + 6, width: this.logo.width * scale, height: this.logo.height * scale });
    } else {
      this.text("deeptrack", this.left, top - 10, { size: 15, font: this.bold });
    }
    this.text(this.meta.title.toUpperCase(), this.right, top - 2, { size: 8.5, font: this.bold, color: COLORS.brand, align: "right" });
    this.text(this.meta.reference, this.right, top - 14, { size: 8, font: this.mono, color: COLORS.muted, align: "right" });
    this.y = A4.height - HEADER_HEIGHT - 14;
  }

  // Starts a new page unless `height` fits on this one.
  ensure(height: number) {
    if (this.y - height < FOOTER_HEIGHT + 10) this.newPage();
  }

  space(height = 10) {
    this.y -= height;
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  // The first-page title block: subject, a verdict badge and a summary.
  titleBlock(params: { eyebrow: string; title: string; verdict: { label: string; tone: Tone }; summary?: string | null; facts: Array<[string, string]> }) {
    this.text(params.eyebrow.toUpperCase(), this.left, this.y, { size: 8, font: this.bold, color: COLORS.muted });
    this.y -= 22;
    const titleLines = this.wrap(params.title, this.width - 170, 20, this.bold);
    titleLines.slice(0, 2).forEach((line, index) => this.text(line, this.left, this.y - index * 24, { size: 20, font: this.bold }));
    // The result, in its colour, on the right.
    const tone = TONES[params.verdict.tone];
    this.text("RESULT", this.right, this.y + 12, { size: 7, font: this.bold, color: COLORS.muted, align: "right" });
    this.text(params.verdict.label, this.right, this.y - 2, { size: 13, font: this.bold, color: tone.fg, align: "right" });
    this.y -= Math.min(titleLines.length, 2) * 24 + 4;
    if (params.summary) {
      for (const line of this.wrap(params.summary, this.width, 10)) {
        this.text(line, this.left, this.y, { size: 10 });
        this.y -= 14;
      }
      this.y -= 4;
    }
    // Facts strip.
    const columns = Math.min(params.facts.length, 4);
    if (columns) {
      const columnWidth = this.width / columns;
      this.y -= 6;
      params.facts.slice(0, 4).forEach(([label, value], index) => {
        const x = this.left + index * columnWidth;
        this.text(label.toUpperCase(), x, this.y - 6, { size: 7, font: this.bold, color: COLORS.muted });
        this.text(this.wrap(value, columnWidth - 16, 9)[0] ?? "", x, this.y - 20, { size: 9 });
      });
      this.y -= 52;
    }
  }

  heading(title: string, hint?: string) {
    this.ensure(hint ? 64 : 48);
    this.y -= 8;
    this.text(title, this.left, this.y, { size: 12.5, font: this.bold, color: COLORS.brand });
    this.y -= 16;
    if (hint) {
      for (const line of this.wrap(hint, this.width, 8.5)) {
        this.text(line, this.left, this.y, { size: 8.5, color: COLORS.muted });
        this.y -= 11;
      }
    }
    this.y -= 6;
  }

  subheading(title: string) {
    this.ensure(34);
    this.y -= 4;
    this.text(title, this.left, this.y, { size: 10.5, font: this.bold });
    this.y -= 14;
  }

  // Label / value rows in two columns, with thin separators.
  rows(rows: Array<[string, unknown]>, options: { labelWidth?: number; mono?: string[] } = {}) {
    const labelWidth = options.labelWidth ?? 150;
    const valueWidth = this.width - labelWidth - 8;
    for (const [label, value] of rows) {
      const font = options.mono?.includes(label) ? this.mono : this.regular;
      const labelLines = this.wrap(label, labelWidth - 6, 9);
      const valueLines = this.wrap(value === null || value === undefined || value === "" ? "-" : value, valueWidth, 9, font);
      const height = Math.max(labelLines.length, valueLines.length) * 12 + 4.5;
      this.ensure(height);
      labelLines.forEach((line, index) => this.text(line, this.left, this.y - index * 12, { size: 9, color: COLORS.muted }));
      valueLines.forEach((line, index) => this.text(line, this.left + labelWidth, this.y - index * 12, { size: 9, font }));
      this.y -= height;
    }
    this.y -= 2;
  }

  paragraph(value: string, options: { size?: number; color?: RGB; font?: PDFFont } = {}) {
    const size = options.size ?? 9;
    for (const line of this.wrap(value, this.width, size, options.font)) {
      this.ensure(size + 5);
      this.text(line, this.left, this.y, { size, color: options.color, font: options.font });
      this.y -= size + 4;
    }
    this.y -= 4;
  }

  bullets(items: string[], options: { checkbox?: boolean } = {}) {
    for (const item of items) {
      const lines = this.wrap(item, this.width - 16, 9);
      this.ensure(lines.length * 12 + 4);
      if (options.checkbox) this.text("[  ]", this.left - 2, this.y, { size: 8.5, color: COLORS.muted });
      else this.page.drawCircle({ x: this.left + 3, y: this.y + 2.5, size: 1.6, color: COLORS.ink });
      lines.forEach((line, index) => this.text(line, this.left + 16, this.y - index * 12, { size: 9 }));
      this.y -= lines.length * 12 + 4;
    }
    this.y -= 2;
  }

  // A shaded note box (what to do next, warnings).
  callout(value: string, tone: Tone = "neutral", label?: string) {
    const colors = TONES[tone];
    const lines = this.wrap(value, this.width - 12, 8.8);
    this.ensure((label ? 12 : 0) + lines.length * 11.5 + 6);
    if (label) {
      this.text(label, this.left + 12, this.y, { size: 8.8, font: this.bold, color: colors.fg });
      this.y -= 12;
    }
    lines.forEach((line, index) => this.text(line, this.left + 12, this.y - index * 11.5, { size: 8.8, color: COLORS.ink }));
    this.y -= lines.length * 11.5 + 6;
  }

  // A table with fixed column widths (fractions of the page width).
  table(headers: string[], rows: unknown[][], widths: number[], options: { toneColumn?: number; tones?: Tone[] } = {}) {
    const columnWidths = widths.map((fraction) => fraction * this.width);
    const drawHeader = () => {
      this.ensure(22);
      let x = this.left;
      headers.forEach((header, index) => {
        this.text(header.toUpperCase(), x, this.y, { size: 7, font: this.bold, color: COLORS.muted });
        x += columnWidths[index];
      });
      this.y -= 20;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, index) => this.wrap(cell === null || cell === undefined || cell === "" ? "-" : cell, columnWidths[index] - 10, 8.8));
      const height = Math.max(...cells.map((lines) => lines.length)) * 11.5 + 8;
      if (this.y - height < FOOTER_HEIGHT + 10) {
        this.newPage();
        drawHeader();
      }
      let x = this.left;
      cells.forEach((lines, index) => {
        const tone = options.toneColumn === index && options.tones ? TONES[options.tones[rowIndex]].fg : COLORS.ink;
        lines.forEach((line, lineIndex) => this.text(line, x, this.y - lineIndex * 11.5, { size: 8.8, color: tone, font: options.toneColumn === index ? this.bold : this.regular }));
        x += columnWidths[index];
      });
      this.y -= height;
    });
    this.y -= 4;
  }

  // A boxed item (a match): a title line with tags, then rows.
  card(title: string, tags: Array<{ label: string; tone: Tone }>, rows: Array<[string, unknown]>, options: { eyebrow?: string; mono?: string[] } = {}) {
    this.ensure(70);
    this.y -= 6;
    if (options.eyebrow) {
      this.text(options.eyebrow, this.left, this.y, { size: 7.5, color: COLORS.muted });
      this.y -= 12;
    }
    let tagX = this.right;
    for (const tag of [...tags].reverse()) {
      const width = this.bold.widthOfTextAtSize(pdfText(tag.label.toUpperCase()), 7.5);
      tagX -= width;
      this.text(tag.label.toUpperCase(), tagX, this.y, { size: 7.5, font: this.bold, color: TONES[tag.tone].fg });
      tagX -= 12;
    }
    const titleLines = this.wrap(title, tagX - this.left - 10, 10.5, this.bold);
    titleLines.forEach((line, index) => this.text(line, this.left, this.y - index * 13, { size: 10.5, font: this.bold }));
    this.y -= titleLines.length * 13 + 6;
    this.rows(rows, { labelWidth: 130, mono: options.mono });
  }

  // Lines to sign on.
  signatureLines(labels: string[]) {
    this.ensure(56);
    this.y -= 30;
    const gap = 18;
    const width = (this.width - gap * (labels.length - 1)) / labels.length;
    labels.forEach((label, index) => {
      const x = this.left + index * (width + gap);
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + width, y: this.y }, thickness: 0.7, color: COLORS.muted });
      this.text(label, x, this.y - 12, { size: 8, color: COLORS.muted });
    });
    this.y -= 26;
  }

  // Footers on every page, once the page count is known.
  async save(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      this.page = page;
      this.text(`Confidential${this.meta.organization ? ` - prepared for ${this.meta.organization}` : ""} - generated ${pdfDateTime(this.meta.generatedAt)}`, this.left, FOOTER_HEIGHT - 20, { size: 7.5, color: COLORS.muted });
      this.text(`Sentinel by DeepTrack  ·  Page ${index + 1} of ${pages.length}`, this.right, FOOTER_HEIGHT - 20, { size: 7.5, color: COLORS.muted, align: "right" });
    });
    return await this.doc.save();
  }
}

export async function fetchLogo(url = "/deeptrack-transparent.png"): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export function saveBytes(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
