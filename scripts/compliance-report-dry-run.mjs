import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const periodEnd = Date.parse("2026-08-21T00:00:00.000Z");
const periodStart = periodEnd - 7 * 24 * 60 * 60 * 1000;

// Deliberately synthetic schema-shaped fixtures. No network, Convex, or real
// customer data is used; this validates only the export contract and hash.
const exportData = {
  generatedAt: periodEnd,
  periodStart,
  periodEnd,
  verifications: [
    {
      id: "verification_fixture_001",
      reference: "ver_fixture_001",
      clientId: "client_fixture_001",
      type: "aml",
      status: "completed",
      verdict: "review",
      confidence: 0.96,
      createdAt: periodStart + 3600000,
      completedAt: periodStart + 4200000,
    },
  ],
  reviews: [
    {
      id: "review_fixture_001",
      verificationId: "verification_fixture_001",
      clientId: "client_fixture_001",
      priority: "high",
      status: "pending",
      triggerType: "auto_escalation",
      createdAt: periodStart + 4300000,
      resolvedAt: null,
    },
  ],
  screeningAudit: [
    {
      id: "audit_fixture_001",
      action: "aml.screened",
      targetId: "verification_fixture_001",
      clientId: "client_fixture_001",
      metadata: { matchCount: 1, source: "OFAC_SDN", fixture: true },
      timestamp: periodStart + 4200000,
    },
  ],
};

const exportJson = JSON.stringify(exportData);
const exportHash = createHash("sha256").update(exportJson).digest("hex");
const report = {
  reportType: "weekly_compliance",
  periodStart,
  periodEnd,
  generatedAt: periodEnd,
  status: "completed",
  verificationCount: exportData.verifications.length,
  amlVerificationCount: exportData.verifications.filter((row) => row.type === "aml").length,
  completedCount: exportData.verifications.filter((row) => row.status === "completed").length,
  failedCount: exportData.verifications.filter((row) => row.status === "failed").length,
  passCount: exportData.verifications.filter((row) => row.verdict === "pass").length,
  reviewCount: exportData.verifications.filter((row) => row.verdict === "review").length,
  rejectCount: exportData.verifications.filter((row) => row.verdict === "reject").length,
  reviewQueueCount: exportData.reviews.length,
  screeningAuditCount: exportData.screeningAudit.filter((row) => row.action === "aml.screened").length,
  screeningFailureCount: exportData.screeningAudit.filter((row) => row.action === "aml.screening_failed").length,
  exportData,
  exportHash,
};

const requiredFields = [
  "reportType", "periodStart", "periodEnd", "generatedAt", "status",
  "verificationCount", "amlVerificationCount", "completedCount", "failedCount",
  "passCount", "reviewCount", "rejectCount", "reviewQueueCount",
  "screeningAuditCount", "screeningFailureCount", "exportData", "exportHash",
];
for (const field of requiredFields) {
  if (!(field in report)) throw new Error(`Missing report field: ${field}`);
}
if (!/^[a-f0-9]{64}$/.test(report.exportHash)) throw new Error("Invalid SHA-256 export hash");
if (report.exportData.verifications.length !== report.verificationCount) throw new Error("Verification count mismatch");
if (report.exportData.reviews.length !== report.reviewQueueCount) throw new Error("Review count mismatch");
if (report.exportData.screeningAudit.length !== report.screeningAuditCount) throw new Error("Audit count mismatch");

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/compliance-report-dry-run.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: "artifacts/compliance-report-dry-run.json",
  reportType: report.reportType,
  status: report.status,
  verificationCount: report.verificationCount,
  reviewQueueCount: report.reviewQueueCount,
  screeningAuditCount: report.screeningAuditCount,
  exportHash: report.exportHash,
}, null, 2));
