const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AML report query: any client member, AML only, review and monitoring included", () => {
  const source = read("backend/convex/amlReport.ts");
  assert.match(source, /const REPORT_ROLES = \["client_admin", "compliance_analyst", "developer", "viewer"\] as const;/);
  assert.match(source, /if \(!verification \|\| verification\.type !== "aml"\) return null;/);
  assert.match(source, /ctx\.db\.normalizeId\("verifications", args\.verificationId\)/, "a bad id is not found, not an error");
  assert.match(source, /withIndex\("by_verification", \(q\) => q\.eq\("verificationId", verification\._id\)\)/);
  assert.match(source, /withIndex\("by_enrolled_verification"/);
  assert.match(source, /subject && subject\.clientId === verification\.clientId/, "never another client's subject");
  assert.match(source, /verification: withoutMedia\(verification\)/);
});

test("AML report page: every finished screening links to it, with PDF, CSV and JSON downloads", () => {
  const list = read("app/(platform)/aml-check/aml-screening-form.tsx");
  assert.match(list, /href=\{`\/aml-check\/\$\{row\._id\}`\}/);
  assert.match(list, /\{outcome\.label\} · View report/);

  const report = read("app/(platform)/aml-check/[id]/aml-report.tsx");
  assert.match(report, /useAuthedQuery\(anyApi\.amlReport\.forClient, \{ verificationId \}\)/);
  assert.match(report, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(report, /\$\{fileBase\}-matches\.csv/);
  assert.match(report, /\$\{fileBase\}\.json/);
  for (const section of ["Risk summary", "Subject screened", "Findings", "Review", "Sources screened", "Method and definitions"]) {
    assert.match(report, new RegExp(`title="${section}"`), section);
  }
  for (const category of ["sanctions", "pep", "special_interest", "fitness_probity", "adverse_media", "insolvency"]) {
    assert.match(report, new RegExp(`  ${category}:\\s*\\n?\\s*"`), `next steps for ${category}`);
  }
  assert.match(report, /print:hidden/, "buttons are left out of the PDF");
});

test("CSV export escapes quotes, commas and newlines", () => {
  const report = read("app/(platform)/aml-check/[id]/aml-report.tsx");
  const body = report.slice(report.indexOf("function csvCell"), report.indexOf("function matchesCsv"));
  const csvCell = new Function(`${body.replace(/: unknown\): string/, ")").replace("function csvCell(value", "return function (value")}`)();
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(["a", "b"]), "a; b");
  assert.equal(csvCell(null), "");
});
