import type Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { birthDateMatch, type PepClass } from "./amlCategories";
import { normalizeName } from "./amlMatching";
import { canonicalKey, tokenAlignmentScore } from "./nameMatching";

// Sentinel's Kenyan PEP register (pepRegister.ts): national, county and
// parastatal office holders and their relatives and close associates,
// curated by DeepTrack from Kenya Gazette notices it uploads, CSV imports
// and manual entries. Screened alongside the international lists; a hit
// is always a PEP case for review, never an automatic reject.

export const PEP_LEVELS = [
  "national_executive", // President, Deputy, Cabinet Secretaries, Principal Secretaries, Attorney General
  "parliament", // MPs, Senators, Speakers
  "judiciary", // Judges of the superior courts, Chief Registrar
  "constitutional_office", // Commissions and independent offices (IEBC, EACC, Auditor-General...)
  "security", // Generals, Inspector-General, Directors of NIS, DCI, KDF chiefs
  "diplomatic", // Ambassadors, High Commissioners
  "county_executive", // Governors, Deputy Governors
  "county_government", // County Executive Committee members, Chief Officers, MCAs, Speakers
  "state_corporation", // Chairs, board members and CEOs of state corporations and parastatals
  "political_party", // Party leaders and officials
  "family_associate", // Relatives and close associates of a PEP
] as const;
export type PepLevel = (typeof PEP_LEVELS)[number];

export const PEP_LEVEL_LABELS: Record<PepLevel, string> = {
  national_executive: "National executive",
  parliament: "Parliament",
  judiciary: "Judiciary",
  constitutional_office: "Constitutional commission or independent office",
  security: "Security services",
  diplomatic: "Diplomatic service",
  county_executive: "County governor / deputy governor",
  county_government: "County government",
  state_corporation: "State corporation / parastatal",
  political_party: "Political party",
  family_associate: "Family member or close associate",
};

// Classes as in lib/amlCategories.ts (FATF-style tiers).
export const PEP_LEVEL_CLASS: Record<PepLevel, PepClass> = {
  national_executive: 1,
  parliament: 1,
  judiciary: 1,
  constitutional_office: 1,
  security: 2,
  diplomatic: 2,
  county_executive: 2,
  county_government: 3,
  state_corporation: 3,
  political_party: 3,
  family_associate: 4,
};

// A register hit counts at or above this name score.
export const PEP_MIN_SCORE = 85;

export type PepEntry = {
  _id: string;
  fullName: string;
  aliases: string[];
  position: string;
  organisation: string | null;
  level: PepLevel;
  county: string | null;
  startDate: string | null;
  endDate: string | null;
  birthDate: string | null;
  relatedTo: string | null; // for a relative / associate: the PEP and relationship
};

export type PepMatch = { entry: PepEntry; nameScore: number; method: "exact" | "normalized" | "fuzzy"; birthDateMatch: "match" | "mismatch" | "unknown" };

export function isCurrent(entry: Pick<PepEntry, "endDate">, now = Date.now()): boolean {
  return !entry.endDate || Date.parse(`${entry.endDate.slice(0, 10)}T00:00:00Z`) > now;
}

// Compares a screened person with a register entry. A date of birth more
// than a year apart rules the entry out.
export function matchPepEntry(subject: { name: string; dateOfBirth?: string | null }, entry: PepEntry): PepMatch | null {
  const name = normalizeName(subject.name);
  if (!name) return null;
  let best: PepMatch | null = null;
  for (const listed of [entry.fullName, ...entry.aliases]) {
    const candidate = normalizeName(listed);
    if (!candidate) continue;
    let nameScore: number;
    let method: PepMatch["method"];
    if (candidate === name) {
      nameScore = 100;
      method = "exact";
    } else if (canonicalKey(candidate) === canonicalKey(name)) {
      nameScore = 96;
      method = "normalized";
    } else {
      nameScore = tokenAlignmentScore(name, candidate);
      method = "fuzzy";
    }
    if (!best || nameScore > best.nameScore) best = { entry, nameScore, method, birthDateMatch: "unknown" };
  }
  if (!best || best.nameScore < PEP_MIN_SCORE) return null;
  const dob = birthDateMatch(subject.dateOfBirth ?? null, entry.birthDate ? [entry.birthDate] : []);
  if (dob === "mismatch") return null;
  return { ...best, birthDateMatch: dob };
}

// ── Kenya Gazette extraction ───────────────────────────────────────────────

export const GAZETTE_MODEL = "claude-opus-5-5";

export type GazetteAppointment = {
  fullName: string;
  position: string;
  organisation: string | null;
  level: PepLevel;
  county: string | null;
  effectiveDate: string | null;
  endsAppointment: boolean; // a revocation / end of term
  gazetteNotice: string | null;
};

const GAZETTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["appointments"],
  properties: {
    appointments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fullName", "position", "organisation", "level", "county", "effectiveDate", "endsAppointment", "gazetteNotice"],
        properties: {
          fullName: { type: "string" },
          position: { type: "string" },
          organisation: { type: ["string", "null"] },
          level: { type: "string", enum: [...PEP_LEVELS] },
          county: { type: ["string", "null"] },
          effectiveDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          endsAppointment: { type: "boolean" },
          gazetteNotice: { type: ["string", "null"], description: "e.g. Gazette Notice No. 12345" },
        },
      },
    },
  },
} as const;

export const GAZETTE_SYSTEM_PROMPT = `You read Kenya Gazette issues for an anti-money-laundering PEP register.

Extract every appointment, election, nomination, designation, re-appointment, revocation or end of term of a person to a prominent public function in Kenya:
- national executive (Cabinet Secretaries, Principal Secretaries, Attorney General, Solicitor General), Parliament, judges and senior judicial officers;
- constitutional commissions and independent offices, senior security officers, ambassadors and high commissioners;
- governors and deputy governors, County Executive Committee members, County Chief Officers, county assembly speakers and clerks, MCAs;
- chairpersons, board members and chief executives of state corporations, parastatals, regulators, public universities and funds;
- senior political party officials.

Do not extract: land, probate, company winding-up, lost documents, licences, marriage or insolvency notices, or junior staff.
Copy names and titles exactly as printed (drop honorifics like Hon., Dr., Amb.). One entry per person per position. Use null when a field isn't stated. Set endsAppointment for revocations and ends of term.`;

export async function extractGazetteAppointments(client: Anthropic, document: { pdfBase64?: string; text?: string }, label: string): Promise<GazetteAppointment[]> {
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = document.pdfBase64
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } },
        { type: "text", text: `Kenya Gazette issue: ${label}. Extract the appointments.` },
      ]
    : [{ type: "text", text: `Kenya Gazette issue: ${label}.\n\n<gazette>\n${(document.text ?? "").slice(0, 400_000)}\n</gazette>\n\nExtract the appointments.` }];
  const response = await client.beta.messages.parse({
    model: GAZETTE_MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(GAZETTE_SCHEMA) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: GAZETTE_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("The extraction was declined");
  const parsed = response.parsed_output as { appointments: GazetteAppointment[] } | null;
  if (!parsed) throw new Error(response.stop_reason === "max_tokens" ? "The issue is too long to read in one go; split it." : "No structured output");
  return parsed.appointments
    .filter((item) => item.fullName.trim().length > 3 && item.position.trim())
    .map((item) => ({
      ...item,
      fullName: item.fullName.trim().replace(/\s+/g, " ").slice(0, 160),
      position: item.position.trim().slice(0, 200),
      organisation: item.organisation?.trim().slice(0, 200) || null,
      county: item.county?.trim().slice(0, 60) || null,
      effectiveDate: item.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(item.effectiveDate) ? item.effectiveDate : null,
      gazetteNotice: item.gazetteNotice?.trim().slice(0, 80) || null,
    }))
    .slice(0, 1000);
}

// ── CSV import ─────────────────────────────────────────────────────────────

export type PepImportRow = Omit<PepEntry, "_id">;

// Columns: full_name, position, organisation, level, county, start_date,
// end_date, birth_date, aliases (; separated), related_to.
export function parsePepCsv(csv: string): { rows: PepImportRow[]; errors: string[] } {
  const lines = csv.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: ["The file is empty."] };
  const split = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted && char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const header = split(lines[0]).map((name) => name.toLowerCase().replace(/\s+/g, "_"));
  const column = (name: string) => header.indexOf(name);
  if (column("full_name") < 0 || column("position") < 0 || column("level") < 0) return { rows: [], errors: ["The header needs full_name, position and level columns."] };
  const rows: PepImportRow[] = [];
  const errors: string[] = [];
  const date = (value: string | undefined) => (value && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) ? value : null);
  lines.slice(1, 20_001).forEach((line, index) => {
    const cells = split(line);
    const get = (name: string) => (column(name) >= 0 ? cells[column(name)]?.trim() || undefined : undefined);
    const level = get("level") as PepLevel | undefined;
    if (!get("full_name") || !get("position")) return void errors.push(`Line ${index + 2}: name and position are required.`);
    if (!level || !(PEP_LEVELS as readonly string[]).includes(level)) return void errors.push(`Line ${index + 2}: level must be one of ${PEP_LEVELS.join(", ")}.`);
    rows.push({
      fullName: get("full_name")!.slice(0, 160),
      position: get("position")!.slice(0, 200),
      organisation: get("organisation")?.slice(0, 200) ?? null,
      level,
      county: get("county")?.slice(0, 60) ?? null,
      startDate: date(get("start_date")),
      endDate: date(get("end_date")),
      birthDate: date(get("birth_date")),
      aliases: (get("aliases") ?? "").split(";").map((alias) => alias.trim()).filter(Boolean).slice(0, 10),
      relatedTo: get("related_to")?.slice(0, 200) ?? null,
    });
  });
  return { rows, errors: errors.slice(0, 50) };
}
