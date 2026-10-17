import type { ShieldSummary } from "@/backend/convex/lib/deepfakeShield";
import type { ReportSection } from "./report-spec";

// The deepfake shield section of the PDF reports.
export const shieldSection = (summary: ShieldSummary): ReportSection => ({
  heading: "Deepfake shield",
  hint: "DeepTrack Live checks the face for a deepfake or synthetic face; document forensics look for AI-generated or edited documents.",
  blocks: [
    { kind: "callout", tone: summary.status === "clear" ? "green" : summary.status === "detected" ? "red" : summary.status === "uncertain" ? "amber" : "neutral", label: summary.headline, text: summary.checks.filter((check) => check.outcome !== "clear").map((check) => `${check.name}: ${check.detail}`).join(" ") || "Every deepfake and AI-forgery check was clear." },
    { kind: "rows", rows: summary.checks.map((check) => [`${check.name} (${check.by})`, `${{ clear: "Clear", flagged: "Flagged", uncertain: "Unclear", not_run: "Not run" }[check.outcome]}: ${check.detail}`] as [string, string]) },
  ],
});
