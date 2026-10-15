import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";

// The invoice PDF template (A4): DeepTrack logo, invoice / tax invoice
// title, parties, lines, totals, and either how to pay or, once paid, the
// receipt details with a PAID stamp. Built in the browser from
// billing.invoice; downloaded automatically when a Paystack payment is
// confirmed and from the invoice pages.

export type InvoicePdfData = {
  number: string;
  status: "issued" | "paid" | "void";
  currency: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  vatRatePct: number;
  vat: number;
  total: number;
  credits: number;
  buyer: { name: string; address?: string; kraPin?: string; email?: string };
  seller: { name: string; address?: string; kraPin?: string; email?: string; paymentInstructions?: string };
  issuedAt: number;
  dueAt: number;
  paidAt: number | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  notes?: string | null;
};

const BRAND = rgb(5 / 255, 149 / 255, 221 / 255);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.88, 0.9, 0.92);
const PAID = rgb(0.02, 0.59, 0.41);
const METHOD_LABELS: Record<string, string> = { paystack: "Paystack (card / mobile money)", bank_transfer: "Bank transfer", mpesa: "M-Pesa", other: "Other" };

// Helvetica (WinAnsi) can't draw every character: keep Latin-1, replace the rest.
export function pdfText(value: string): string {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[  ]/g, " ").replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "?");
}

export function pdfMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pdfDate(value: number): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfText(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildInvoicePdf(invoice: InvoicePdfData, logoPng?: Uint8Array | ArrayBuffer | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.status === "paid" ? "Receipt" : "Invoice"} ${invoice.number}`);
  doc.setAuthor(pdfText(invoice.seller.name));
  doc.setCreator("Sentinel by DeepTrack");
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 48;
  const right = width - margin;
  const text = (value: string, x: number, y: number, options: { size?: number; font?: PDFFont; color?: typeof INK; align?: "left" | "right" } = {}) => {
    const size = options.size ?? 10;
    const font = options.font ?? regular;
    const safe = pdfText(value);
    const drawX = options.align === "right" ? x - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: drawX, y, size, font, color: options.color ?? INK });
  };

  // Brand band and logo.
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: BRAND });
  let y = height - margin;
  if (logoPng) {
    try {
      const logo = await doc.embedPng(logoPng);
      const scale = 130 / logo.width;
      page.drawImage(logo, { x: margin, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    } catch {
      text("deeptrack", margin, y - 22, { size: 22, font: bold });
    }
  } else {
    text("deeptrack", margin, y - 22, { size: 22, font: bold });
  }
  const title = invoice.status === "paid" ? "RECEIPT" : invoice.vatRatePct > 0 ? "TAX INVOICE" : "INVOICE";
  text(title, right, y - 16, { size: 20, font: bold, color: BRAND, align: "right" });
  text(invoice.number, right, y - 32, { size: 10, font: bold, align: "right" });
  text(`Issued ${pdfDate(invoice.issuedAt)}`, right, y - 46, { size: 9, color: MUTED, align: "right" });
  text(invoice.status === "paid" && invoice.paidAt ? `Paid ${pdfDate(invoice.paidAt)}` : `Due ${pdfDate(invoice.dueAt)}`, right, y - 58, { size: 9, color: invoice.status === "paid" ? PAID : MUTED, align: "right" });
  y -= 92;

  // Parties.
  const party = (label: string, data: InvoicePdfData["buyer"], x: number) => {
    let line = y;
    text(label.toUpperCase(), x, line, { size: 8, color: MUTED });
    line -= 14;
    text(data.name, x, line, { size: 11, font: bold });
    for (const detail of [...(data.address ? wrap(data.address, regular, 9, 230) : []), data.kraPin ? `KRA PIN ${data.kraPin}` : null, data.email ?? null]) {
      if (!detail) continue;
      line -= 12;
      text(detail, x, line, { size: 9, color: MUTED });
    }
    return line;
  };
  y = Math.min(party("From", invoice.seller, margin), party("Bill to", invoice.buyer, width / 2 + 10)) - 30;

  // Lines.
  const columns = { qty: right - 190, unit: right - 100, amount: right };
  page.drawRectangle({ x: margin, y: y - 6, width: right - margin, height: 20, color: rgb(0.95, 0.97, 0.99) });
  text("DESCRIPTION", margin + 6, y, { size: 8, font: bold, color: MUTED });
  text("QTY", columns.qty, y, { size: 8, font: bold, color: MUTED, align: "right" });
  text("UNIT PRICE", columns.unit, y, { size: 8, font: bold, color: MUTED, align: "right" });
  text("AMOUNT", columns.amount - 6, y, { size: 8, font: bold, color: MUTED, align: "right" });
  y -= 24;
  for (const line of invoice.lines) {
    const described = wrap(line.description, regular, 10, columns.qty - margin - 60);
    described.forEach((part, index) => text(part, margin + 6, y - index * 13));
    text(String(line.quantity), columns.qty, y, { align: "right" });
    text(pdfMoney(line.unitPrice, invoice.currency), columns.unit, y, { align: "right" });
    text(pdfMoney(line.amount, invoice.currency), columns.amount - 6, y, { align: "right" });
    y -= described.length * 13 + 8;
    page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: LINE });
  }

  // Totals.
  y -= 10;
  const totalsTop = y;
  const total = (label: string, value: string, strong = false) => {
    text(label, columns.unit, y, { size: strong ? 11 : 10, font: strong ? bold : regular, color: strong ? INK : MUTED, align: "right" });
    text(value, columns.amount - 6, y, { size: strong ? 11 : 10, font: strong ? bold : regular, align: "right" });
    y -= strong ? 18 : 15;
  };
  total("Subtotal", pdfMoney(invoice.subtotal, invoice.currency));
  if (invoice.vatRatePct > 0) total(`VAT ${invoice.vatRatePct}%`, pdfMoney(invoice.vat, invoice.currency));
  page.drawLine({ start: { x: columns.qty - 40, y: y + 10 }, end: { x: right, y: y + 10 }, thickness: 0.8, color: INK });
  y -= 2;
  total(`Total (${invoice.currency})`, pdfMoney(invoice.total, invoice.currency), true);
  if (invoice.status === "paid") total("Amount paid", pdfMoney(invoice.total, invoice.currency));
  if (invoice.status === "paid") total("Balance due", pdfMoney(0, invoice.currency), true);
  y -= 12;
  if (invoice.credits) {
    text(`${invoice.credits.toLocaleString("en-US")} Sentinel credits ${invoice.status === "paid" ? "were added to your balance" : "are added when this invoice is paid"}.`, margin, y, { size: 10 });
    y -= 22;
  }

  // Payment: receipt details, or how to pay.
  const boxTop = y;
  const boxLines =
    invoice.status === "paid"
      ? [
          `Paid on ${invoice.paidAt ? pdfDate(invoice.paidAt) : "-"} by ${METHOD_LABELS[invoice.paymentMethod ?? "other"] ?? invoice.paymentMethod ?? "-"}.`,
          ...(invoice.paymentReference ? [`Payment reference: ${invoice.paymentReference}`] : []),
          "Thank you for your payment.",
        ]
      : invoice.status === "void"
        ? ["This invoice was cancelled and is not payable."]
        : [
            "Pay online by card or mobile money from the Billing page in Sentinel.",
            ...(invoice.seller.paymentInstructions ? wrap(invoice.seller.paymentInstructions, regular, 9, right - margin - 24) : []),
            `Use ${invoice.number} as the payment reference.`,
          ];
  const boxHeight = 30 + boxLines.length * 13;
  page.drawRectangle({ x: margin, y: boxTop - boxHeight + 12, width: right - margin, height: boxHeight, color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 0.5 });
  text(invoice.status === "paid" ? "PAYMENT RECEIVED" : invoice.status === "void" ? "CANCELLED" : "HOW TO PAY", margin + 12, boxTop - 4, { size: 8, font: bold, color: invoice.status === "paid" ? PAID : MUTED });
  boxLines.forEach((line, index) => text(line, margin + 12, boxTop - 20 - index * 13, { size: 9 }));
  y = boxTop - boxHeight - 8;
  if (invoice.notes) {
    for (const line of wrap(invoice.notes, regular, 8, right - margin)) {
      y -= 11;
      text(line, margin, y, { size: 8, color: MUTED });
    }
  }

  // Stamp.
  if (invoice.status !== "issued") {
    const label = invoice.status === "paid" ? "PAID" : "CANCELLED";
    const color = invoice.status === "paid" ? PAID : MUTED;
    const size = 34;
    const stampWidth = bold.widthOfTextAtSize(label, size) + 24;
    // Left of the totals, where the page is empty.
    const stampX = margin + 30;
    const stampY = totalsTop - 52;
    page.drawRectangle({ x: stampX, y: stampY, width: stampWidth, height: 48, borderColor: color, borderWidth: 2.5, rotate: degrees(8), opacity: 0, borderOpacity: 0.85 });
    page.drawText(label, { x: stampX + 10, y: stampY + 12, size, font: bold, color, rotate: degrees(8), opacity: 0.85 });
  }

  // Footer.
  page.drawLine({ start: { x: margin, y: 54 }, end: { x: right, y: 54 }, thickness: 0.5, color: LINE });
  text(`${invoice.seller.name}${invoice.seller.kraPin ? ` · KRA PIN ${invoice.seller.kraPin}` : ""}${invoice.seller.email ? ` · ${invoice.seller.email}` : ""}`, margin, 40, { size: 8, color: MUTED });
  text("Sentinel by DeepTrack · sentinel.deeptrack.io", right, 40, { size: 8, color: MUTED, align: "right" });

  return await doc.save();
}

export function invoiceFileName(invoice: Pick<InvoicePdfData, "number" | "status">): string {
  return `${invoice.status === "paid" ? "Receipt" : "Invoice"}-${invoice.number}.pdf`;
}

// Browser: builds the PDF with the DeepTrack logo and saves it.
export async function downloadInvoicePdf(invoice: InvoicePdfData): Promise<void> {
  let logo: ArrayBuffer | null = null;
  try {
    const response = await fetch("/deeptrack-transparent.png");
    if (response.ok) logo = await response.arrayBuffer();
  } catch {
    logo = null;
  }
  const bytes = await buildInvoicePdf(invoice, logo);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = invoiceFileName(invoice);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
