// AML risk categories and PEP classes for screening hits. Every hit is put
// into one or more of the categories Sentinel reports on, and PEP hits get a
// Class 1–4 tier. No imports, so tests can transpile and evaluate this file.
//
// Categories (what clients see on a screening result):
//   sanctions         sanctions lists, sanction-linked entities, terrorism, frozen assets
//   pep               politically exposed persons, with pepClass 1–4
//   special_interest  special interest persons/entities: wanted, crime, persons of interest
//   fitness_probity   disqualified directors, debarment, regulator actions and warnings
//   adverse_media     negative news (news screening; OpenSanctions has no such topic)
//   insolvency        bankruptcy and insolvency registers
//
// PEP classes (FATF / Wolfsberg style, highest risk first):
//   1  heads of state or government, national ministers and legislators,
//      senior national judiciary, central bank and other national financial
//      integrity officials
//   2  regional / state government, ambassadors and diplomats, senior
//      military and security officials
//   3  senior management of state-owned enterprises and international
//      organisations, political party officials, municipal government,
//      senior civil servants
//   4  family members and close associates of a PEP

export type RiskCategory =
  | "sanctions"
  | "pep"
  | "special_interest"
  | "fitness_probity"
  | "adverse_media"
  | "insolvency";

export type PepClass = 1 | 2 | 3 | 4;

export const RISK_CATEGORIES: RiskCategory[] = [
  "sanctions",
  "pep",
  "special_interest",
  "fitness_probity",
  "adverse_media",
  "insolvency",
];

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  sanctions: "Sanctions & watchlists",
  pep: "Politically exposed person",
  special_interest: "Special interest person / entity",
  fitness_probity: "Fitness & probity",
  adverse_media: "Adverse media",
  insolvency: "Insolvency",
};

export const PEP_CLASS_LABELS: Record<PepClass, string> = {
  1: "PEP Class 1 — national / head of state level",
  2: "PEP Class 2 — regional, diplomatic or senior military",
  3: "PEP Class 3 — state-owned enterprise, international organisation, party or local government",
  4: "PEP Class 4 — family member or close associate",
};

const SANCTION_TOPICS = new Set(["sanction", "sanction.linked", "crime.terror", "asset.frozen", "export.control"]);
const PEP_TOPICS = new Set(["role.pep", "role.rca"]);
const FITNESS_TOPICS = new Set(["corp.disqual", "debarment", "reg.action", "reg.warn"]);
const SPECIAL_INTEREST_TOPICS = new Set(["wanted", "poi", "role.oligarch", "export.risk", "corp.shell", "corp.offshore"]);
const INSOLVENCY_TOPICS = new Set(["corp.insolvent", "corp.bankrupt", "insolvency"]);
const ADVERSE_MEDIA_TOPICS = new Set(["media.adverse"]);

const CLASS_1_TOPICS = new Set(["gov.head", "gov.national", "gov.financial"]);
const CLASS_2_TOPICS = new Set(["gov.state", "role.diplo", "mil", "gov.security"]);
const CLASS_3_TOPICS = new Set(["gov.muni", "gov.soe", "gov.igo", "pol.party", "gov.admin"]);

// The PEP class implied by a hit's topics, or null when it isn't a PEP. A
// PEP whose topics don't state a level is treated as Class 1: unknown means
// the strictest due diligence, never the lightest.
export function pepClassFor(topics: string[]): PepClass | null {
  const set = new Set(topics);
  const isPep = set.has("role.pep");
  const isRca = set.has("role.rca");
  if (!isPep && !isRca) return null;
  if (isRca && !isPep) return 4;
  if ([...set].some((topic) => CLASS_1_TOPICS.has(topic))) return 1;
  if ([...set].some((topic) => CLASS_2_TOPICS.has(topic))) return 2;
  if ([...set].some((topic) => CLASS_3_TOPICS.has(topic))) return 3;
  return 1;
}

export function categoriesFor(topics: string[]): RiskCategory[] {
  const found = new Set<RiskCategory>();
  for (const topic of topics) {
    if (SANCTION_TOPICS.has(topic)) found.add("sanctions");
    else if (PEP_TOPICS.has(topic)) found.add("pep");
    else if (FITNESS_TOPICS.has(topic)) found.add("fitness_probity");
    else if (INSOLVENCY_TOPICS.has(topic)) found.add("insolvency");
    else if (ADVERSE_MEDIA_TOPICS.has(topic)) found.add("adverse_media");
    else if (SPECIAL_INTEREST_TOPICS.has(topic) || topic === "crime" || topic.startsWith("crime.")) {
      found.add("special_interest");
    }
  }
  return RISK_CATEGORIES.filter((category) => found.has(category));
}

export type CategorizedHit = { categories: RiskCategory[]; pepClass?: PepClass | null };

export type CategorySummary = Record<
  RiskCategory,
  { hits: number; highestPepClass?: PepClass | null }
>;

// Per-category hit counts for a screening, plus the most severe PEP class.
export function summarizeCategories(hits: CategorizedHit[]): CategorySummary {
  const summary = Object.fromEntries(RISK_CATEGORIES.map((category) => [category, { hits: 0 }])) as CategorySummary;
  for (const hit of hits) {
    for (const category of hit.categories) summary[category].hits += 1;
    if (hit.pepClass) {
      const current = summary.pep.highestPepClass;
      summary.pep.highestPepClass = current ? (Math.min(current, hit.pepClass) as PepClass) : hit.pepClass;
    }
  }
  return summary;
}

// "YYYY", "YYYY-MM" or "YYYY-MM-DD"; anything else is rejected at input.
export function isPartialIsoDate(value: string): boolean {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2100) return false;
  if (month !== undefined && (month < 1 || month > 12)) return false;
  if (day !== undefined && (day < 1 || day > 31)) return false;
  return true;
}

// Compares the subject's date of birth with a hit's birth dates. Precision is
// the coarser of the two; "unknown" when either side has no date. Years one
// apart still match, because lists often record only an approximate year.
export function birthDateMatch(subject: string | null | undefined, candidates: string[]): "match" | "mismatch" | "unknown" {
  if (!subject || candidates.length === 0) return "unknown";
  const subjectParts = subject.split("-");
  let anyComparable = false;
  for (const candidate of candidates) {
    const candidateParts = candidate.slice(0, 10).split("-");
    if (!/^\d{4}$/.test(candidateParts[0] ?? "")) continue;
    anyComparable = true;
    const yearGap = Math.abs(Number(subjectParts[0]) - Number(candidateParts[0]));
    if (yearGap > 1) continue;
    const precision = Math.min(subjectParts.length, candidateParts.length);
    if (precision === 1 || yearGap === 1) return "match";
    if (subjectParts.slice(0, precision).join("-") === candidateParts.slice(0, precision).join("-")) return "match";
  }
  return anyComparable ? "mismatch" : "unknown";
}
