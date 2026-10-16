import { PEP_CLASS_LABELS, RISK_CATEGORY_LABELS, type PepClass, type RiskCategory } from "@/backend/convex/lib/amlCategories";

// Shared by the AML report page and its PDF (aml-report-pdf.ts): the
// report's shape, labels, next steps and helpers.

export { PEP_CLASS_LABELS, RISK_CATEGORY_LABELS };

export type PepPosition = { title: string; country: string | null; startDate: string | null; endDate: string | null; current: boolean };

export type Match = {
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

export type Report = {
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

export const SOURCE_LABELS: Record<string, string> = {
  OFAC_SDN: "OFAC Specially Designated Nationals list (US Treasury)",
  UN_CONSOLIDATED: "UN Security Council Consolidated List",
  EU_FSF: "EU Consolidated Financial Sanctions List",
  UK_SANCTIONS: "UK Sanctions List (FCDO)",
  OPENSANCTIONS: "OpenSanctions (global sanctions, PEP and risk data)",
  ADVERSE_MEDIA: "Adverse media (news)",
  KE_PEP: "Sentinel Kenyan PEP register",
  FBI_MOST_WANTED: "FBI Most Wanted",
};

export const METHOD_LABELS: Record<string, string> = {
  exact: "Exact name match",
  normalized: "Name match after normalisation (case, accents, punctuation)",
  alias: "Match on a listed alias",
  fuzzy: "Similar name (fuzzy match)",
  provider_score: "OpenSanctions match score (name and identifiers)",
  ai_classification: "News article assessed by AI",
};

export const COVERAGE_STATUS: Record<string, string> = {
  screened: "Screened",
  unavailable: "Unavailable at the time of screening",
  not_configured: "Not configured",
  disabled: "Turned off",
};

// What a reviewer should do for each kind of hit.
export const NEXT_STEPS: Record<RiskCategory, string> = {
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

export const CHECKLIST = [
  "Compared the subject's identifiers (date of birth, nationality, ID or registration number) with every match",
  "Decided for each match whether it is the same subject, and recorded why",
  "Applied the required due diligence for each confirmed category",
  "Recorded the final risk rating and decision, with approver name and date",
  "Filed a suspicious transaction report if required",
];

export function reviewStatusLabel(review: NonNullable<Report["review"]>) {
  if (review.status === "resolved") {
    if (review.resolutionAction === "confirm") return "Resolved — the match was a false positive (cleared)";
    if (review.resolutionAction === "keep_verdict") return "Resolved — the match was confirmed";
    return "Resolved";
  }
  if (review.recommendation) return "Awaiting second approval (four-eyes)";
  return review.status === "in_review" ? "Escalated — under investigation" : "Awaiting review";
}

export function matchStrength(match: Match): string {
  if (match.source === "ADVERSE_MEDIA") return match.media?.severity === "high" ? "High severity" : "Medium severity";
  if (match.matchScore >= 94) return "Strong";
  if (match.matchScore >= 85) return "Close";
  return "Possible";
}

export function categoryOf(match: Match): RiskCategory {
  return match.categories?.[0] ?? "sanctions";
}
