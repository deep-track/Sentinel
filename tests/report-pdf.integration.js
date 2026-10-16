const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { PDFDocument } = require("pdf-lib");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Transpiles TS modules, resolving relative and "@/" imports.
function load(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  });
  const module = { exports: {} };
  cache.set(file, module.exports);
  const localRequire = (specifier) => {
    const target = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    if (!target) return require(specifier);
    for (const ext of ["", ".ts", ".tsx"]) {
      if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) return load(target + ext, cache);
    }
    throw new Error(`cannot resolve ${specifier}`);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const { buildAmlReportPdf } = load(path.join(root, "components/reports/aml-report-pdf.ts"));
const { pdfText, PdfReport } = load(path.join(root, "components/reports/pdf-document.ts"));
const logo = fs.readFileSync(path.join(root, "public/deeptrack-transparent.png"));
const t = Date.UTC(2026, 9, 14, 20, 54);

const report = (overrides = {}) => ({
  clientName: "Acme",
  organization: { legalName: "Acme Bank PLC", registrationNumber: null, regulator: null, licenceNumber: null, complianceContact: null, logoUrl: null },
  review: null,
  monitoring: null,
  verification: {
    reference: "ver_1",
    status: "completed",
    verdict: "pass",
    creditsUsed: 1,
    createdAt: t,
    updatedAt: t,
    completedAt: t,
    input: { subjectName: "Brian Koyundi – 中", entityType: "individual", country: "KE" },
    result: { reason: "No match found.", matches: [], categories: {}, coverage: { checkedSources: [], openSanctions: "screened", adverseMedia: "screened" } },
    ...overrides,
  },
});

test("the AML report PDF is A4 portrait, titled, with the logo and page numbers", async () => {
  const bytes = await buildAmlReportPdf(report(), logo, t);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), "AML Screening Report ver_1");
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    assert.ok(height > width, "portrait");
    assert.equal(Math.round(width), 595);
  }
  const noLogo = await PDFDocument.load(await buildAmlReportPdf(report(), null, t));
  assert.ok(noLogo.getPageCount() >= 1, "builds without a logo");
});

test("long reports flow onto more pages", async () => {
  const match = (index) => ({
    source: "OPENSANCTIONS",
    sourceRecordId: `Q${index}`,
    entityName: `Possible match ${index}`,
    program: "unknown",
    matchScore: 88,
    matchMethod: "provider_score",
    riskLevel: "high",
    categories: ["pep"],
    pepClass: 2,
    topics: ["role.pep"],
  });
  const many = report({ verdict: "review", result: { reason: "Possible PEP.", matches: Array.from({ length: 12 }, (_, index) => match(index)), categories: { pep: { hits: 12, highestPepClass: 2 } }, coverage: { checkedSources: [] } } });
  const doc = await PDFDocument.load(await buildAmlReportPdf(many, logo, t));
  assert.ok(doc.getPageCount() >= 3, `${doc.getPageCount()} pages`);
});

test("text the PDF fonts can't draw is replaced, and wrapping never overflows", async () => {
  assert.equal(pdfText("A – “b” → 中"), 'A - "b" -> ?');
  const pdf = await PdfReport.create({ title: "Test", reference: "r", organization: null, generatedAt: t }, null);
  const lines = pdf.wrap("https://www.example.com/" + "x".repeat(300), 200, 9);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(pdf.regular.widthOfTextAtSize(line, 9) <= 200.5);
});

test("wiring: the report page downloads the PDF; browser printing is A4 portrait", () => {
  assert.match(read("app/(platform)/aml-check/[id]/aml-report.tsx"), /downloadAmlReportPdf\(report\)/);
  assert.match(read("app/globals.css"), /@page \{\s*size: A4 portrait;/);
  assert.doesNotMatch(read("components/reports/pdf-document.ts").replace(/signatureLines[\s\S]*?\n  \}/, ""), /drawRectangle|drawLine/, "no boxes or rules (only the signature lines)");
});
