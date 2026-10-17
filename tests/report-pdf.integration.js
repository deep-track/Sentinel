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

// ── KYC, KYB and document reports ───────────────────────────────────────────

const { renderReportSpec } = load(path.join(root, "components/reports/report-spec.ts"));
const { kycReportSpec } = load(path.join(root, "components/reports/kyc-report-spec.ts"));
const { kybReportSpec } = load(path.join(root, "components/reports/kyb-report-spec.ts"));
const { documentReportSpec } = load(path.join(root, "components/reports/document-report-spec.ts"));

const allText = (spec) => JSON.stringify(spec);

test("KYC report: steps with results, the ID number masked, review lines when held", async () => {
  const spec = kycReportSpec({
    reference: "ver_k",
    status: "completed",
    verdict: "review",
    createdAt: t,
    updatedAt: t,
    completedAt: t + 5000,
    input: { firstName: "Grace", lastName: "Achieng", dateOfBirth: "1991-05-14", gender: "female", idNumber: "29384756", documentFrontBase64: "AAAA" },
    result: { docScan: { fakeScore: 0.6, flags: ["font_mismatch"], documentType: "National ID" }, iprs: { error: "upstream_timeout" }, aml: { status: "CLEAR", matches: [] } },
  });
  assert.equal(spec.title, "KYC Identity Report");
  assert.equal(spec.subject, "Grace Achieng");
  assert.deepEqual(spec.verdict, { label: "Needs review", tone: "amber" });
  const steps = spec.sections.find((section) => section.heading === "Verification steps").blocks.find((block) => block.kind === "table");
  assert.deepEqual(steps.rows.map((row) => row[1]), ["Failed", "Not run", "Error", "CLEAR"]);
  assert.match(allText(spec), /\*\*\*\*4756/);
  assert.doesNotMatch(allText(spec), /29384756|AAAA/, "no full ID number or images in the report");
  assert.ok(spec.sections.some((section) => section.heading === "Review"));
  const doc = await PDFDocument.load(await renderReportSpec(spec, logo, t));
  assert.equal(doc.getTitle(), "KYC Identity Report ver_k");
});

test("KYB report: the checks, the registry, every party's screening and the directors", async () => {
  const spec = kybReportSpec(
    {
      reference: "ver_b",
      status: "completed",
      verdict: "pass",
      createdAt: t,
      updatedAt: t,
      input: { businessName: "Savannah Logistics Limited", registrationNumber: "PVT-1" },
      result: {
        automated: true,
        reason: "Business verified.",
        certificate: { verdict: "pass", reason: "Matches.", checks: [{ name: "Registered name matches", status: "passed" }] },
        registry: { verdict: "pass", reason: "Matches BRS.", record: { companyName: "SAVANNAH", kraPin: "P051234567X", shareholders: [{ name: "GRACE" }] } },
        parties: [{ name: "Savannah", role: "business", verdict: "pass", complete: true, reason: "clear", hits: 0, suppressed: 0 }],
      },
    },
    [{ firstName: "Grace", lastName: "Achieng", email: "g@s.co.ke", position: "director", shareholding: "50", idNumber: "28374651", status: "verified" }],
    "Kenya",
  );
  assert.deepEqual(spec.verdict, { label: "Approved", tone: "green" });
  const text = allText(spec);
  for (const expected of ["Registration certificate: Passed", "Company registry (Kenya BRS): Passed", "P051234567X", "AML screening of the business and its people", "Directors and beneficial owners (1)", "****4651"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.doesNotMatch(text, /28374651/);
  assert.ok(!spec.sections.some((section) => section.heading === "Review"), "no signature lines on an approved business");
  assert.ok((await PDFDocument.load(await renderReportSpec(spec, logo, t))).getPageCount() >= 1);
});

test("document report: identity and proof of address titles, findings by severity", async () => {
  const base = { reference: "ver_d", status: "completed", verdict: "reject", createdAt: t, completedAt: t };
  const identity = documentReportSpec({
    clientName: "Acme",
    review: null,
    verification: { ...base, input: { documentKind: "identity" }, result: { riskScore: 92, flags: [{ code: "visual_ai_generated", severity: "critical", source: "vision", message: "Looks AI-generated." }], identity: { fields: { fullName: "JOHN DOE" }, mrz: null, age: null, isAdult: null, expectedNameMatch: null, expectedDateOfBirthMatch: null } } },
  });
  assert.equal(identity.title, "Identity Document Report");
  assert.equal(identity.subject, "JOHN DOE");
  assert.deepEqual(identity.verdict, { label: "Rejected", tone: "red" });
  assert.equal(identity.sections[0].heading, "Warning", "an AI-generated document is called out first");
  const findings = identity.sections.find((section) => section.heading === "Fraud and authenticity findings").blocks[0];
  assert.deepEqual(findings.tones, ["red"]);
  const poa = documentReportSpec({ clientName: null, review: null, verification: { ...base, verdict: "pass", input: { documentKind: "proof_of_address", expectedName: "Jane" }, result: { documentKind: "proof_of_address" } } });
  assert.equal(poa.title, "Proof of Address Report");
  assert.equal(poa.fileName, "Proof-of-address-report-ver_d.pdf");
  assert.ok((await PDFDocument.load(await renderReportSpec(identity, logo, t))).getPageCount() >= 1);
});

test("wiring: KYC, KYB and document pages download the new PDFs", () => {
  assert.match(read("app/(platform)/kyc/[id]/page.tsx"), /<ReportPdfButton spec=\{kycReportSpec\(record\)\} \/>/);
  assert.match(read("app/(platform)/kyb/[id]/page.tsx"), /<ReportPdfButton spec=\{kybReportSpec\(verification, directors, country\)\} \/>/);
  assert.match(read("app/(platform)/idp/[id]/document-report.tsx"), /<ReportPdfButton spec=\{documentReportSpec\(report as DocumentReportData\)\} \/>/);
  assert.equal(fs.existsSync(path.join(root, "app/(platform)/kyc/[id]/report-actions.tsx")), false, "the old print button is gone");
});
