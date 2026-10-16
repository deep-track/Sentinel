// Customer risk rating (risk-based approach, CBK / FRC guidance): a score
// from the customer's geography, PEP status, screening hits, customer type,
// industry, onboarding channel and, for businesses, ownership. It sets the
// periodic review frequency. Hits a reviewer cleared don't count.
// No imports, so tests and the portal can load it directly.

export const RISK_LEVELS = ["low", "medium", "high", "prohibited"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// FATF lists as of the 19 June 2026 statement. DeepTrack keeps them current
// in the Back Office after each plenary (Feb / Jun / Oct); these are only
// the fallback.
export const FATF_DEFAULTS = {
  asOf: "2026-06-19",
  callForAction: ["KP", "IR", "MM"],
  increasedMonitoring: ["AO", "BO", "BA", "BG", "CM", "CI", "CD", "HT", "IQ", "KE", "KW", "LA", "LB", "MC", "NP", "PG", "SS", "SY", "VE", "VN", "VG", "YE"],
};

export const HIGH_RISK_INDUSTRIES = [
  "money_services", // remittance, forex bureaus, mobile money agents
  "virtual_assets", // crypto exchanges, VASPs
  "gambling",
  "precious_metals_stones",
  "real_estate",
  "charity_ngo",
  "arms_defence",
  "cash_intensive",
  "trust_company_services",
] as const;
export const INDUSTRY_LABELS: Record<(typeof HIGH_RISK_INDUSTRIES)[number], string> = {
  money_services: "Money services (remittance, forex, mobile money agency)",
  virtual_assets: "Virtual assets (crypto, VASP)",
  gambling: "Gambling and betting",
  precious_metals_stones: "Precious metals and stones",
  real_estate: "Real estate",
  charity_ngo: "Charity / NGO",
  arms_defence: "Arms and defence",
  cash_intensive: "Cash-intensive business",
  trust_company_services: "Trust and company services",
};

// Words in a business type or name that suggest a higher-risk industry.
const INDUSTRY_WORDS: Array<[RegExp, (typeof HIGH_RISK_INDUSTRIES)[number]]> = [
  [/\b(forex|bureau de change|remittance|money transfer|mobile money|m-?pesa agent)\b/i, "money_services"],
  [/\b(crypto|bitcoin|virtual asset|vasp|blockchain exchange)\b/i, "virtual_assets"],
  [/\b(betting|casino|gaming|lottery|gambling)\b/i, "gambling"],
  [/\b(gold|diamond|gemstone|precious (metal|stone)|mining)\b/i, "precious_metals_stones"],
  [/\b(real estate|property developer|realtor|estate agency)\b/i, "real_estate"],
  [/\b(foundation|charity|ngo|non-governmental|trust fund)\b/i, "charity_ngo"],
  [/\b(arms|ammunition|defence|defense)\b/i, "arms_defence"],
];

export function industryFrom(text: string | null | undefined): (typeof HIGH_RISK_INDUSTRIES)[number] | null {
  if (!text) return null;
  if ((HIGH_RISK_INDUSTRIES as readonly string[]).includes(text)) return text as (typeof HIGH_RISK_INDUSTRIES)[number];
  return INDUSTRY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export type RatingHit = { source: string; categories: string[]; pepClass?: number | null; riskLevel?: string };

export type RatingInput = {
  entityType: "individual" | "entity";
  countries: Array<string | null | undefined>; // residence / nationality / incorporation, ISO codes or names
  homeCountry: string; // the client's own country: domestic customers aren't scored up for it
  hits: RatingHit[]; // hits still standing (not cleared)
  verdict?: "pass" | "review" | "reject" | null;
  industry?: string | null;
  remoteOnboarding?: boolean;
  ownership?: { untraced: number; layers: number; foreignHolders: number } | null;
  name?: string | null;
};

export type RatingConfig = {
  callForAction: string[];
  increasedMonitoring: string[];
  reviewMonths: Record<Exclude<RiskLevel, "prohibited">, number>;
};

export const DEFAULT_REVIEW_MONTHS = { high: 12, medium: 24, low: 36 };

export type RiskRating = {
  score: number;
  level: RiskLevel;
  factors: Array<{ factor: string; points: number; detail: string }>;
  reviewMonths: number | null; // null when prohibited (exit the relationship)
};

const COUNTRY_NAMES: Record<string, string> = {
  KENYA: "KE", "NORTH KOREA": "KP", "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC OF": "KP", IRAN: "IR", MYANMAR: "MM", "SOUTH SUDAN": "SS", SYRIA: "SY", YEMEN: "YE", VENEZUELA: "VE", HAITI: "HT", LEBANON: "LB",
  "DEMOCRATIC REPUBLIC OF THE CONGO": "CD", "DR CONGO": "CD", IRAQ: "IQ", ANGOLA: "AO", BOLIVIA: "BO", CAMEROON: "CM", "COTE D'IVOIRE": "CI", "IVORY COAST": "CI", NEPAL: "NP", VIETNAM: "VN", LAOS: "LA", KUWAIT: "KW", MONACO: "MC", BULGARIA: "BG",
};

export function countryCode(value: string | null | undefined): string | null {
  const text = value?.trim().toUpperCase();
  if (!text) return null;
  if (/^[A-Z]{2}$/.test(text)) return text;
  if (/^[A-Z]{3}$/.test(text)) return { KEN: "KE", UGA: "UG", TZA: "TZ", SOM: "SO", ETH: "ET", PRK: "KP", IRN: "IR", MMR: "MM", SSD: "SS", SYR: "SY", YEM: "YE" }[text] ?? null;
  return COUNTRY_NAMES[text] ?? null;
}

export function rateCustomer(input: RatingInput, config: RatingConfig): RiskRating {
  const factors: RiskRating["factors"] = [];
  const add = (factor: string, points: number, detail: string) => factors.push({ factor, points, detail });

  // Geography (the client's own country isn't a risk factor for its customers).
  const home = countryCode(input.homeCountry) ?? input.homeCountry.toUpperCase();
  const codes = [...new Set(input.countries.map(countryCode).filter((code): code is string => Boolean(code) && code !== home))];
  const blacklisted = codes.filter((code) => config.callForAction.includes(code));
  const greylisted = codes.filter((code) => config.increasedMonitoring.includes(code));
  if (blacklisted.length) add("Geography", 50, `FATF call-for-action jurisdiction: ${blacklisted.join(", ")}`);
  else if (greylisted.length) add("Geography", 20, `FATF jurisdiction under increased monitoring: ${greylisted.join(", ")}`);
  else if (codes.length) add("Geography", 5, `Foreign connection: ${codes.join(", ")}`);

  // Screening hits still standing.
  const has = (category: string) => input.hits.some((hit) => hit.categories.includes(category));
  const pepClasses = input.hits.filter((hit) => hit.categories.includes("pep")).map((hit) => hit.pepClass ?? 1);
  if (has("sanctions")) add("Sanctions", input.verdict === "reject" ? 100 : 40, input.verdict === "reject" ? "Confirmed sanctions match" : "Possible sanctions match under review");
  if (pepClasses.length) {
    const highest = Math.min(...pepClasses);
    add("PEP", highest <= 2 ? 35 : highest === 3 ? 25 : 20, `Politically exposed person, Class ${highest}`);
  }
  if (has("special_interest")) add("Special interest", 25, "Listed as a person or entity of special interest (wanted, investigated, convicted)");
  if (has("fitness_probity")) add("Fitness & probity", 20, "Regulatory enforcement, debarment or disqualification");
  if (has("adverse_media")) add("Adverse media", 20, "Adverse media reports");
  if (has("insolvency")) add("Insolvency", 10, "Insolvency or bankruptcy record");

  // Customer type and industry.
  if (input.entityType === "entity") add("Customer type", 5, "Company or organisation");
  const industry = industryFrom(input.industry) ?? (input.entityType === "entity" ? industryFrom(input.name) : null);
  if (industry) add("Industry", 20, INDUSTRY_LABELS[industry]);
  if (input.remoteOnboarding) add("Channel", 5, "Onboarded remotely (non-face-to-face)");

  // Ownership (businesses).
  if (input.ownership) {
    if (input.ownership.untraced > 0) add("Ownership", 20, `${input.ownership.untraced} owner${input.ownership.untraced === 1 ? "" : "s"} couldn't be traced`);
    if (input.ownership.layers >= 2) add("Ownership", 10, `${input.ownership.layers} layers of company ownership`);
    if (input.ownership.foreignHolders > 0) add("Ownership", 10, "Foreign company shareholders");
  }

  const score = Math.min(100, 10 + factors.reduce((sum, factor) => sum + factor.points, 0));
  // Floors: a confirmed sanctions match is prohibited; a PEP (POCAMLA
  // requires enhanced due diligence for PEPs) or a call-for-action
  // jurisdiction is always high risk.
  const level: RiskLevel =
    has("sanctions") && input.verdict === "reject" ? "prohibited" : blacklisted.length > 0 || pepClasses.length > 0 || score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, factors, reviewMonths: level === "prohibited" ? null : config.reviewMonths[level] };
}

export function nextReviewAt(from: number, months: number | null): number | null {
  if (months === null) return null;
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High", prohibited: "Prohibited" };
