// Pure sanctions-list matching logic shared by aml.ts (screening) and
// amlPersistence.ts / watchlists.ts (coverage). No Convex imports, so it can be
// unit tested directly.

export const SOURCE_KEYS = ["OFAC_SDN", "UN_CONSOLIDATED"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<SourceKey, string> = {
  OFAC_SDN: "OFAC SDN",
  UN_CONSOLIDATED: "UN Consolidated",
};

export type SourceCadence = "daily" | "weekly";

const DAY_MS = 24 * 60 * 60 * 1000;

// A list older than this is "stale": screening against it cannot auto-pass.
// Daily lists tolerate two missed runs; weekly lists one missed run.
export const MAX_LIST_AGE_MS: Record<SourceCadence, number> = {
  daily: 3 * DAY_MS,
  weekly: 14 * DAY_MS,
};

export const FUZZY_REVIEW_THRESHOLD = 70;
export const STRONG_MATCH_THRESHOLD = 94;
// Score assigned when the subject and a listed name contain the same tokens in
// a different order ("DOE JOHN" vs "JOHN DOE").
export const TOKEN_ORDER_MATCH_SCORE = 97;

export type SubjectEntityType = "individual" | "entity";
export type EntryEntityType = "individual" | "entity" | "unknown";
export type MatchMethod = "exact" | "normalized" | "alias" | "fuzzy";
export type CountryMatch = "match" | "mismatch" | "unknown";

export type ScreeningEntry = {
  sourceKey: SourceKey;
  entityType: EntryEntityType;
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  isActive: boolean;
};

export type Candidate<E extends ScreeningEntry> = E & {
  nameScore: number;
  method: MatchMethod;
  countryMatch: CountryMatch;
};

export type Decision = { verdict: "pass" | "review" | "reject"; reason: string };

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenKey(normalized: string): string {
  return normalized.split(" ").filter(Boolean).sort().join(" ");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

export function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let overlap = 0;
  for (const value of leftBigrams) if (rightBigrams.has(value)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size || 1);
}

// Individuals are not matched against entity entries (and vice versa) when
// the list tells us the entry's type. Unknown-type entries always match.
export function entityTypesCompatible(subject: SubjectEntityType, entry: EntryEntityType): boolean {
  return entry === "unknown" || entry === subject;
}

function isCountryCode(value: string): boolean {
  return value.length <= 3 && !value.includes(" ");
}

// Compares like with like: an ISO code is only compared against codes, a name
// against names. Anything not comparable is "unknown", never "mismatch".
export function compareCountry(subjectCountry: string | null | undefined, entryCountries: string[]): CountryMatch {
  const subject = subjectCountry ? normalizeName(subjectCountry) : "";
  if (!subject) return "unknown";
  const subjectIsCode = isCountryCode(subject);
  const comparable = entryCountries
    .map(normalizeName)
    .filter((country) => country && isCountryCode(country) === subjectIsCode);
  if (comparable.length === 0) return "unknown";
  const matched = comparable.some(
    (country) => country === subject || ` ${country} `.includes(` ${subject} `),
  );
  return matched ? "match" : "mismatch";
}

export function scoreCandidate<E extends ScreeningEntry>(
  subjectName: string,
  subjectEntityType: SubjectEntityType,
  subjectCountry: string | null | undefined,
  entry: E,
): Candidate<E> | null {
  const subject = normalizeName(subjectName);
  if (!subject || !entry.isActive) return null;
  if (!entityTypesCompatible(subjectEntityType, entry.entityType)) return null;

  const primary = normalizeName(entry.primaryName);
  const others = [...entry.aliases, ...entry.normalizedNames].map(normalizeName).filter(Boolean);
  const subjectTokens = tokenKey(subject);

  let nameScore = 0;
  let method: MatchMethod = "fuzzy";
  if (primary && primary === subject) {
    nameScore = 100;
    method = "exact";
  } else if (others.includes(subject)) {
    nameScore = 100;
    method = "alias";
  } else if ([primary, ...others].some((name) => name && tokenKey(name) === subjectTokens)) {
    nameScore = TOKEN_ORDER_MATCH_SCORE;
    method = "normalized";
  } else {
    let best = 0;
    for (const name of [primary, ...others]) {
      if (!name) continue;
      const score = diceSimilarity(subject, name);
      if (score > best) best = score;
    }
    nameScore = Math.round(best * 100);
  }

  if (nameScore < FUZZY_REVIEW_THRESHOLD) return null;
  return { ...entry, nameScore, method, countryMatch: compareCountry(subjectCountry, entry.countries) };
}

const METHOD_RANK: Record<MatchMethod, number> = { exact: 0, alias: 1, normalized: 2, fuzzy: 3 };
const COUNTRY_RANK: Record<CountryMatch, number> = { match: 0, unknown: 1, mismatch: 2 };

// Highest score first; country corroboration breaks ties.
export function compareCandidates(left: Candidate<ScreeningEntry>, right: Candidate<ScreeningEntry>): number {
  return (
    right.nameScore - left.nameScore ||
    METHOD_RANK[left.method] - METHOD_RANK[right.method] ||
    COUNTRY_RANK[left.countryMatch] - COUNTRY_RANK[right.countryMatch]
  );
}

export function isStrongMatch(candidate: Candidate<ScreeningEntry>): boolean {
  return candidate.method !== "fuzzy" && candidate.nameScore >= STRONG_MATCH_THRESHOLD;
}

// Considers ALL candidates, not just the top one. Never returns "pass" when
// any candidate exists.
export function decide(candidates: Array<Candidate<ScreeningEntry>>): Decision {
  if (candidates.length === 0) return { verdict: "pass", reason: "No watchlist match found." };
  const strong = candidates.filter(isStrongMatch);
  if (strong.some((candidate) => candidate.countryMatch !== "mismatch")) {
    return {
      verdict: "reject",
      reason: "Exact or normalized sanctions-list match requires compliance escalation.",
    };
  }
  if (strong.length > 0) {
    return {
      verdict: "review",
      reason: "Exact sanctions-list name match with a different listed country requires human identity resolution.",
    };
  }
  if (candidates.some((candidate) => candidate.nameScore >= STRONG_MATCH_THRESHOLD)) {
    return { verdict: "review", reason: "High-confidence fuzzy match requires human identity resolution." };
  }
  return { verdict: "review", reason: "Potential sanctions-list match requires human review." };
}

export function joinList(values: string[], conjunction: "and" | "or"): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values[values.length - 1]}`;
}
