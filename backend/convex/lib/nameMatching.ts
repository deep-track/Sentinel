// Name matching tuned for Kenyan and East African names (used by
// amlMatching.scoreCandidate). Input is a normalized name (amlMatching
// normalizeName: upper case, letters and digits, single spaces).
//
//  - Spelling variants: Arabic, Somali, Swahili and Christian forms of the
//    same name (MOHAMMED / MOHAMED / MAXAMED, HUSSEIN / XUSEEN, YOHANA /
//    JOHN) count as the same name; doubled letters are collapsed first.
//  - Connectors and titles (BIN, BINTI, WA, ARAP, OLE, HON, DR, SHEIKH...)
//    are ignored.
//  - Multi-part names are compared part by part (Jaro-Winkler): every part
//    of the shorter name must match a part of the other, so sharing only a
//    first name ("JOHN KAMAU" / "JOHN KARIUKI") isn't a match. Short parts
//    must be the same name (ALI is not WALI). A name with one part more
//    or less ("JOHN KAMAU" / "JOHN KAMAU MWANGI") is a partial match,
//    capped below the strong-match level so it goes to review, not reject.
// No imports, so tests can load it directly.

// Treated as the same name. Doubled letters are collapsed before lookup,
// so MOHAMMED and MOHAMED both become MOHAMED.
const VARIANT_GROUPS: string[][] = [
  ["MOHAMED", "MOHAMMED", "MOHAMMAD", "MOHAMAD", "MUHAMMAD", "MUHAMMED", "MUHAMED", "MAHAMED", "MAXAMED", "MOHAMEDI", "MOHAMMEDI"],
  ["AHMED", "AHMAD", "AXMED", "AHMEDI"],
  ["ABDULLAHI", "ABDULLAH", "ABDALLA", "ABDALLAH", "ABDULAHI", "CABDULLAAHI", "CABDULLAHI", "ABDALA"],
  ["ABDI", "CABDI"],
  ["ABDIRAHMAN", "ABDURAHMAN", "ABDULRAHMAN", "ABDIRAHMAAN", "CABDIRAXMAAN", "CABDIRAHMAN", "ABDURRAHMAN"],
  ["ABDIKADIR", "ABDULKADIR", "ABDULQADIR", "CABDIQAADIR", "ABDIQADIR"],
  ["ABDIRIZAK", "ABDIRAZAK", "ABDULRAZAK", "CABDIRISAAQ"],
  ["HASSAN", "HASAN", "XASAN", "HASAAN"],
  ["HUSSEIN", "HUSEIN", "HUSSAIN", "HUSAIN", "XUSEEN", "HUSEEN", "HUSAYN"],
  ["YUSUF", "YUSSUF", "YOUSUF", "YOUSSEF", "YUSUFU", "YOUSEF", "JUSUF"],
  ["IBRAHIM", "IBRAAHIM", "IBRAHIIM", "IBRAHIMU", "EBRAHIM"],
  ["ISMAIL", "ISMAEL", "ISMACIIL", "ISMAILI"],
  ["OMAR", "UMAR", "CUMAR", "OMARI", "UMARI"],
  ["ALI", "CALI", "ALLY", "ALII"],
  ["OSMAN", "USMAN", "UTHMAN", "CUSMAAN", "OSMAAN", "OTHMAN", "UTHMAAN"],
  ["SULEIMAN", "SULEMAN", "SULAIMAN", "SULEYMAN", "SULEIMANI", "SULEYMAAN"],
  ["MUSA", "MOUSSA", "MOUSA", "MUUSE", "MUSSA"],
  ["ADAN", "ADEN", "AADAN"],
  ["SAID", "SAEED", "SAYID", "SAIID", "SAYED", "SAIDI"],
  ["SALIM", "SALEEM", "SELIM", "SALIMU"],
  ["RASHID", "RASHEED", "RASHIDI", "RASHIIID"],
  ["HAMISI", "HAMIS", "KHAMIS", "KHAMISI"],
  ["JUMA", "JUMAA", "JUMAH"],
  ["FATUMA", "FATIMA", "FATMA", "FAADUMO", "FATUMAH"],
  ["HALIMA", "XALIIMO", "HALIIMO", "HALIMAH"],
  ["MARYAM", "MARIAM", "MARIAMU", "MARYAN", "MARYAMA", "MERYEM"],
  ["KHADIJA", "KHADIJAH", "KHADIJO", "XADIIJO", "HADIJA", "HADIJAH"],
  ["AISHA", "AYESHA", "AISHAH", "CAASHA", "ASHA"],
  ["ZAINAB", "ZEINAB", "ZAYNAB", "SEYNAB", "ZAINABU"],
  ["JOHN", "YOHANA", "YOHANNA", "YOHANES", "YOHANNES", "JOHANNES"],
  ["PETER", "PETRO", "PETRUS", "PIETRO"],
  ["PAUL", "PAULO", "PAULUS"],
  ["JOSEPH", "YOSEFU", "JOSEF"],
  ["DAVID", "DAUDI", "DAWIT", "DAWUD", "DAUD"],
  ["JAMES", "YAKOBO", "YAKOBU"],
  ["STEPHEN", "STEVEN", "STEFANO", "STEPHANO", "ISTIFANO"],
  ["MICHAEL", "MIKAELI", "MIKAEL"],
  ["EMMANUEL", "IMMANUEL", "EMANUELI"],
  ["ELIZABETH", "ELIZABETI", "ELISABETH"],
  ["MARY", "MARIA", "MARIE"],
  ["CATHERINE", "KATHERINE", "CATHRINE", "KATHRINE", "KATARINA"],
  ["JOYCE", "JOICE"],
  ["GEOFFREY", "JEFFREY", "GEOFREY", "JEFFERY"],
  ["PHILIP", "PHILLIP", "FILIPO"],
  ["FRANCIS", "FRANSISKO", "FRANCISCO"],
];

// Ignored when comparing: connectors and honorifics.
const IGNORED_TOKENS = new Set([
  "BIN", "BINTI", "BINT", "IBN", "BEN", "WA", "ARAP", "OLE", "AND", "AL", "EL",
  "MR", "MRS", "MS", "MISS", "DR", "HON", "HONOURABLE", "PROF", "ENG", "SHEIKH", "SHEIKHE", "SHEKH", "MZEE", "REV", "FR",
  "SIR", "GEN", "COL", "CAPT", "MAJ", "LT", "HE", "HH", "SEN", "AMB", "CS", "PS", "MP",
]);

const collapse = (token: string) => token.replace(/(.)\1+/g, "$1");

const CANONICAL = new Map<string, string>();
for (const group of VARIANT_GROUPS) {
  const canonical = collapse(group[0]);
  for (const variant of group) {
    const key = collapse(variant);
    // Each spelling belongs to one name only.
    if (CANONICAL.has(key) && CANONICAL.get(key) !== canonical) throw new Error(`Name variant in two groups: ${variant}`);
    CANONICAL.set(key, canonical);
  }
}

export function canonicalToken(token: string): string {
  const collapsed = collapse(token);
  return CANONICAL.get(collapsed) ?? collapsed;
}

// The name's meaningful parts, canonicalized.
export function nameTokens(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((token) => token && !IGNORED_TOKENS.has(token))
    .map(canonicalToken);
}

// Same name regardless of order, spelling variant, connector or title.
export function canonicalKey(normalized: string): string {
  return nameTokens(normalized).sort().join(" ");
}

export function jaroWinkler(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const window = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatched = new Array<boolean>(left.length).fill(false);
  const rightMatched = new Array<boolean>(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, right.length);
    for (let j = start; j < end; j++) {
      if (rightMatched[j] || left[i] !== right[j]) continue;
      leftMatched[i] = true;
      rightMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < left.length; i++) {
    if (!leftMatched[i]) continue;
    while (!rightMatched[k]) k++;
    if (left[i] !== right[k]) transpositions++;
    k++;
  }
  const jaro = (matches / left.length + matches / right.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// A part only counts as matching above this similarity.
export const TOKEN_MATCH_MIN = 0.9;
// Highest score for a partial match (names of different length).
export const PARTIAL_MATCH_CAP = 90;

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

function oneVowelApart(left: string, right: string): boolean {
  if (left.length !== right.length || left.length < 4) return false;
  let differences = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    if (!VOWELS.has(left[i]) || !VOWELS.has(right[i])) return false;
    differences += 1;
  }
  return differences === 1;
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  // An initial matches a name starting with it.
  if (left.length === 1 || right.length === 1) return left[0] === right[0] ? 0.9 : 0;
  // One vowel apart, same length: a transliteration (OSAMA / USAMA,
  // LADEN / LADIN), but not two different names (KAMAU / KIMEU).
  if (oneVowelApart(left, right)) return 0.95;
  // Short parts (ALI, OMAR, JUMA): one letter apart with the same first
  // letter (JON / JOHN), otherwise a different name (ALI is not WALI).
  if (Math.min(left.length, right.length) <= 4) return left[0] === right[0] && editDistance(left, right) === 1 ? 0.9 : 0;
  const score = jaroWinkler(left, right);
  return score >= TOKEN_MATCH_MIN ? score : 0;
}

// 0-100. Every part of the shorter name must match a different part of the
// longer one; unmatched parts score 0, so the average falls fast.
export function tokenAlignmentScore(leftNormalized: string, rightNormalized: string): number {
  const left = nameTokens(leftNormalized);
  const right = nameTokens(rightNormalized);
  if (!left.length || !right.length) return 0;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // A partial match covers all but at most one part: "JOHN KAMAU" in "JOHN
  // KAMAU MWANGI", not two common names inside a five-part name.
  if (longer.length - shorter.length > 1) return 0;
  const used = new Set<number>();
  let total = 0;
  let fullParts = 0;
  for (const token of shorter) {
    let best = 0;
    let bestIndex = -1;
    longer.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = tokenSimilarity(token, candidate);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) used.add(bestIndex);
    if (best > 0 && token.length > 1 && longer[bestIndex].length > 1) fullParts += 1;
    total += best;
  }
  // Initials alone ("A. A.") never make a match: at least two full parts
  // must match, or all but the initials of a two-part name.
  if (fullParts < Math.min(2, shorter.filter((token) => token.length > 1).length) || fullParts === 0) return 0;
  const average = total / shorter.length;
  // One-part names ("KAMAU") are too common to match on their own.
  if (shorter.length < 2) return Math.round(average * 100 * 0.75);
  const score = Math.round(average * 100);
  return shorter.length === longer.length ? score : Math.min(score, PARTIAL_MATCH_CAP);
}

// Whether both names have at least two meaningful parts, so part-by-part
// comparison applies (otherwise the caller uses character similarity).
export function isMultiPart(normalized: string): boolean {
  const tokens = nameTokens(normalized);
  return tokens.length >= 2 && tokens.some((token) => token.length > 1);
}
