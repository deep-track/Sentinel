import { checkLabel, checkTone, dateTime, REVIEW_SIGNATURES, type ReportBlock, type ReportSection, type ReportSpec } from "./report-spec";
import { maskId } from "./kyc-report-spec";
import type { Tone } from "./pdf-document";

// The KYB business verification report as a PDF spec: the business, the
// automated checks (certificate, proof of address, Kenya BRS registry, AML
// of the business and everyone declared) and the directors / owners.

type Flag = { code: string; severity: string; message: string };
type Check = { name: string; status: string; detail?: string };
type Component = { verdict: string; reason: string; flags?: Flag[]; checks?: Check[]; fields?: Record<string, unknown> };
type KybResult = {
  automated?: boolean;
  reason?: string;
  certificate?: Component;
  proofOfAddress?: Component;
  registry?: Component & {
    record?: { companyName?: string | null; registrationNumber?: string | null; registrationDate?: string | null; kraPin?: string | null; shareholders?: Array<{ name: string; shares?: string | null }> };
    lateResponse?: { status: string; record?: { companyName?: string | null; active?: boolean | null } };
    ownership?: Ownership;
  };
  parties?: Array<{ name: string; role: string; verdict: string; complete: boolean; reason: string; hits: number; suppressed: number }>;
  riskRating?: { score: number; level: string; factors: Array<{ factor: string; points: number; detail: string }>; reviewMonths: number | null };
};
type Ownership = {
  thresholdPct: number;
  nodes: Array<{ name: string; kind: "person" | "company"; depth: number; path: string[]; directPct: number | null; effectivePct: number | null; resolved: boolean; note: string | null; registrationNumber: string | null }>;
  beneficialOwners: string[];
  untraced: string[];
  sharesKnown: boolean;
};

export type KybRecord = {
  reference: string;
  status: string;
  verdict?: "pass" | "review" | "reject" | null;
  input?: unknown;
  result?: unknown;
  failureReason?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
};
export type KybDirector = { firstName: string; lastName: string; email: string; position: string; shareholding?: string | null; idNumber?: string | null; status: string };

const POSITION_LABELS: Record<string, string> = { director: "Director", shareholder: "Shareholder", beneficial_owner: "Beneficial owner" };

function text(input: unknown, key: string): string | null {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function componentBlocks(name: string, component: Component, extra: Array<[string, string | null]> = []): ReportBlock[] {
  const blocks: ReportBlock[] = [
    { kind: "subheading", text: `${name}: ${checkLabel(component.verdict)}` },
    { kind: "rows", rows: [["Result", component.reason], ...extra] },
  ];
  if (component.checks?.length) {
    blocks.push({
      kind: "table",
      headers: ["Check", "Result", "Detail"],
      rows: component.checks.map((check) => [check.name, checkLabel(check.status), check.detail ?? ""]),
      widths: [0.42, 0.18, 0.4],
      toneColumn: 1,
      tones: component.checks.map((check) => checkTone(check.status)),
    });
  }
  if (component.flags?.length) {
    blocks.push({ kind: "bullets", items: component.flags.slice(0, 8).map((flag) => `${flag.severity.charAt(0).toUpperCase()}${flag.severity.slice(1)}: ${flag.message}`) });
  }
  return blocks;
}

function verdictOf(record: KybRecord): { label: string; tone: Tone } {
  if (record.verdict === "pass") return { label: "Approved", tone: "green" };
  if (record.verdict === "reject") return { label: "Declined", tone: "red" };
  if (record.verdict === "review") return { label: "Needs review", tone: "amber" };
  if (record.status === "failed") return { label: "Could not be verified", tone: "red" };
  return { label: "In progress", tone: "neutral" };
}

export function kybReportSpec(record: KybRecord, directors: KybDirector[], country: string, organization: string | null = null): ReportSpec {
  const input = record.input;
  const data = (record.result && typeof record.result === "object" ? record.result : {}) as KybResult;
  const sections: ReportSection[] = [
    {
      heading: "Business",
      blocks: [
        {
          kind: "rows",
          rows: [
            ["Registered name", text(input, "businessName")],
            ["Registration number", text(input, "registrationNumber")],
            ["Country of incorporation", country],
            ...(text(input, "businessType") ? ([["Business type", text(input, "businessType")]] as Array<[string, string | null]>) : []),
            ["Incorporation certificate", text(input, "registrationDocUrl") ? "Provided" : "Not provided"],
            ["Proof of address", text(input, "proofOfAddressUrl") ? "Provided" : "Not provided"],
          ],
        },
      ],
    },
  ];

  const checks: ReportBlock[] = [];
  if (data.certificate) {
    const fields = data.certificate.fields ?? {};
    checks.push(
      ...componentBlocks("Registration certificate", data.certificate, [
        ["Read as", [fields.companyName, fields.registrationNumber ? `no. ${String(fields.registrationNumber)}` : null, fields.incorporationDate ? `incorporated ${String(fields.incorporationDate)}` : null].filter(Boolean).join(", ") || null],
      ]),
    );
  }
  if (data.proofOfAddress) checks.push(...componentBlocks("Proof of address", data.proofOfAddress));
  if (data.registry) {
    const registryRecord = data.registry.record;
    checks.push(
      ...componentBlocks("Company registry (Kenya BRS)", data.registry, [
        ...(registryRecord
          ? ([
              ["Registered as", [registryRecord.companyName, registryRecord.registrationNumber ? `no. ${registryRecord.registrationNumber}` : null].filter(Boolean).join(", ") || null],
              ["Registered on", registryRecord.registrationDate ?? null],
              ["KRA PIN", registryRecord.kraPin ?? null],
              ["Shareholders on the register", registryRecord.shareholders?.map((holder) => `${holder.name}${holder.shares ? ` (${holder.shares})` : ""}`).join(", ") || null],
            ] as Array<[string, string | null]>)
          : []),
        ...(data.registry.lateResponse
          ? ([["Later answer from the registry", data.registry.lateResponse.status === "found" ? `${data.registry.lateResponse.record?.companyName ?? "Record found"}${data.registry.lateResponse.record?.active === false ? " (not active)" : ""}` : data.registry.lateResponse.status.replace(/_/g, " ")]] as Array<[string, string | null]>)
          : []),
      ]),
    );
  }
  const ownership = data.registry?.ownership;
  if (ownership?.nodes.length) {
    checks.push({ kind: "subheading", text: `Ownership (beneficial owners: ${ownership.thresholdPct}% or more)` });
    checks.push({
      kind: "table",
      headers: ["Holder", "Type", "Holds", "Of the business", "Note"],
      rows: ownership.nodes.map((node) => [
        `${"> ".repeat(node.depth - 1)}${node.name}`,
        node.kind === "company" ? "Company" : "Person",
        node.directPct !== null ? `${node.directPct}%` : "-",
        node.effectivePct !== null ? `${node.effectivePct}%` : "unknown",
        [ownership.beneficialOwners.includes(node.name) ? "Beneficial owner" : null, node.note].filter(Boolean).join(". "),
      ]),
      widths: [0.32, 0.12, 0.11, 0.15, 0.3],
      toneColumn: 3,
      tones: ownership.nodes.map((node) => (node.kind === "person" && (node.effectivePct ?? 100) >= ownership.thresholdPct ? "amber" : node.note ? "amber" : "neutral")),
    });
  }
  if (data.parties?.length) {
    checks.push({ kind: "subheading", text: "AML screening of the business and its people" });
    checks.push({
      kind: "table",
      headers: ["Name", "Role", "Result", "Detail"],
      rows: data.parties.map((party) => [
        party.name,
        party.role === "ubo" ? "Beneficial owner" : party.role === "business" ? "Business" : party.role === "shareholder" ? "Company shareholder" : "Director",
        party.complete ? checkLabel(party.verdict) : "Incomplete",
        `${party.hits ? `${party.hits} hit${party.hits === 1 ? "" : "s"}` : "No hits"}${party.suppressed ? `, ${party.suppressed} cleared before` : ""}${party.verdict !== "pass" ? `. ${party.reason.slice(0, 240)}` : ""}`,
      ]),
      widths: [0.27, 0.17, 0.16, 0.4],
      toneColumn: 2,
      tones: data.parties.map((party) => (party.complete ? checkTone(party.verdict) : "amber")),
    });
  }
  if (data.riskRating) {
    const rating = data.riskRating;
    sections.push({
      heading: "Customer risk rating",
      hint: "From geography, hits still standing, industry, onboarding channel and ownership.",
      blocks: [
        {
          kind: "rows",
          rows: [
            ["Rating", `${rating.level.charAt(0).toUpperCase()}${rating.level.slice(1)} (score ${rating.score} / 100)`],
            ["Periodic review", rating.reviewMonths === null ? "Exit or don't onboard (confirmed sanctions match)" : `Every ${rating.reviewMonths} months`],
            ...rating.factors.map((factor) => [`${factor.factor} (+${factor.points})`, factor.detail] as [string, string]),
          ],
        },
      ],
    });
  }
  if (checks.length) sections.push({ heading: "Automated checks", blocks: checks });
  else if (data.reason) sections.push({ heading: "Automated checks", blocks: [{ kind: "paragraph", text: data.reason }] });

  sections.push({
    heading: `Directors and beneficial owners (${directors.length})`,
    blocks: directors.length
      ? [
          {
            kind: "table",
            headers: ["Name", "Position", "Shareholding", "ID number", "Status"],
            rows: directors.map((director) => [
              `${director.firstName} ${director.lastName}\n${director.email}`,
              POSITION_LABELS[director.position] ?? director.position,
              director.shareholding ? `${director.shareholding}%` : "-",
              maskId(director.idNumber),
              director.status.replace(/_/g, " "),
            ]),
            widths: [0.34, 0.18, 0.15, 0.17, 0.16],
          },
        ]
      : [{ kind: "paragraph", text: "No directors are recorded for this submission." }],
  });

  if (record.verdict && record.verdict !== "pass") sections.push({ heading: "Review", hint: "For the reviewer's decision.", blocks: [REVIEW_SIGNATURES] });
  sections.push({
    heading: "About this report",
    blocks: [
      {
        kind: "paragraph",
        small: true,
        text: "Sentinel reads the registration certificate and proof of address, checks Kenyan companies against the Business Registration Service, and screens the business and every director and beneficial owner against sanctions, PEP, adverse media and other risk lists. ID numbers are masked. A failed or held check is a lead for review, not a finding of wrongdoing.",
      },
    ],
  });

  const business = text(input, "businessName") ?? "Business verification";
  return {
    title: "KYB Business Report",
    reference: record.reference,
    organization,
    eyebrow: `Business verification (KYB)${organization ? ` - ${organization}` : ""}`,
    subject: business,
    verdict: verdictOf(record),
    summary: record.failureReason ?? data.reason ?? null,
    facts: [
      ["Registration no.", text(input, "registrationNumber") ?? "-"],
      ["Country", country],
      ["Submitted", dateTime(record.createdAt)],
      ["Directors / owners", String(directors.length)],
    ],
    sections,
    fileName: `KYB-report-${record.reference}.pdf`,
  };
}
