import type Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { normalizeName } from "./amlMatching";
import { canonicalKey, tokenAlignmentScore } from "./nameMatching";

// Kenyan risk lists (riskLists.ts): enforcement, debarment and wanted lists
// published by Kenyan authorities that OpenSanctions doesn't carry. (World
// Bank and AfDB debarment, Interpol red notices, the FRC domestic terrorism
// list and Kenyan MPs, senators and judges already come through
// OpenSanctions.) DeepTrack adds entries from documents it uploads, a single
// public page it points to (robots.txt is checked first), CSV or by hand;
// a person approves what Claude extracts. A hit is a case for review in the
// list's risk category, never an automatic reject.

export type RiskCategory = "fitness_probity" | "special_interest";

export const RISK_LIST_SOURCES = [
  { key: "KE_PPRA_DEBARRED", label: "PPRA debarred firms and individuals", authority: "Public Procurement Regulatory Authority", category: "fitness_probity", domains: ["ppra.go.ke"] },
  { key: "KE_CBK_ENFORCEMENT", label: "CBK enforcement actions, revocations and warnings", authority: "Central Bank of Kenya", category: "fitness_probity", domains: ["centralbank.go.ke"] },
  { key: "KE_CMA_ENFORCEMENT", label: "CMA enforcement actions", authority: "Capital Markets Authority", category: "fitness_probity", domains: ["cma.or.ke"] },
  { key: "KE_IRA_ENFORCEMENT", label: "IRA enforcement actions", authority: "Insurance Regulatory Authority", category: "fitness_probity", domains: ["ira.go.ke"] },
  { key: "KE_SASRA_ENFORCEMENT", label: "SASRA enforcement actions", authority: "Sacco Societies Regulatory Authority", category: "fitness_probity", domains: ["sasra.go.ke"] },
  { key: "KE_RBA_ENFORCEMENT", label: "RBA enforcement actions", authority: "Retirement Benefits Authority", category: "fitness_probity", domains: ["rba.go.ke"] },
  { key: "KE_EACC", label: "EACC cases, convictions and wanted persons", authority: "Ethics and Anti-Corruption Commission", category: "special_interest", domains: ["eacc.go.ke"] },
  { key: "KE_DCI_WANTED", label: "DCI wanted persons", authority: "Directorate of Criminal Investigations", category: "special_interest", domains: ["dci.go.ke"] },
  { key: "KE_ARA_FORFEITURE", label: "Assets Recovery Agency forfeiture cases", authority: "Assets Recovery Agency", category: "special_interest", domains: ["ara.go.ke"] },
  { key: "KE_OTHER", label: "Other Kenyan official notices", authority: "Various", category: "fitness_probity", domains: [] },
] as const satisfies ReadonlyArray<{ key: string; label: string; authority: string; category: RiskCategory; domains: readonly string[] }>;

export type RiskListKey = (typeof RISK_LIST_SOURCES)[number]["key"];
export const RISK_LIST_KEYS = RISK_LIST_SOURCES.map((source) => source.key) as RiskListKey[];
export const riskListSource = (key: string) => RISK_LIST_SOURCES.find((source) => source.key === key);

export type RiskEntry = {
  _id: string;
  sourceKey: RiskListKey;
  name: string;
  aliases: string[];
  entityType: "individual" | "entity";
  reason: string;
  action: string | null; // e.g. "Debarred for 3 years", "Licence revoked"
  startDate: string | null;
  endDate: string | null;
  reference: string | null;
};

export const RISK_MIN_SCORE = 85;

// Company names are compared without their legal form.
const LEGAL_SUFFIXES = /\b(LIMITED|LTD|PLC|CO|COMPANY|INC|LLC|LLP|ENTERPRISES?|HOLDINGS|GROUP|KENYA|K|AND)\b/g;
const forEntity = (normalized: string) => normalized.replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();

export type RiskMatch = { entry: RiskEntry; nameScore: number; method: "exact" | "normalized" | "fuzzy"; ended: boolean };

export function matchRiskEntry(subject: { name: string; entityType: "individual" | "entity" }, entry: RiskEntry, now = Date.now()): RiskMatch | null {
  if (subject.entityType !== entry.entityType) return null;
  const prepare = (value: string) => (entry.entityType === "entity" ? forEntity(normalizeName(value)) : normalizeName(value));
  const name = prepare(subject.name);
  if (!name) return null;
  let best: RiskMatch | null = null;
  for (const listed of [entry.name, ...entry.aliases]) {
    const candidate = prepare(listed);
    if (!candidate) continue;
    let nameScore: number;
    let method: RiskMatch["method"];
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
    if (!best || nameScore > best.nameScore) best = { entry, nameScore, method, ended: false };
  }
  if (!best || best.nameScore < RISK_MIN_SCORE) return null;
  return { ...best, ended: Boolean(entry.endDate && Date.parse(`${entry.endDate.slice(0, 10)}T00:00:00Z`) < now) };
}

// ── Extraction from a document or page ─────────────────────────────────────

export const RISK_LIST_MODEL = "claude-opus-5-5";

export type ExtractedRiskEntry = Omit<RiskEntry, "_id" | "sourceKey">;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "aliases", "entityType", "reason", "action", "startDate", "endDate", "reference"],
        properties: {
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          entityType: { type: "string", enum: ["individual", "entity"] },
          reason: { type: "string", description: "Why they are listed, in one sentence." },
          action: { type: ["string", "null"], description: "e.g. Debarred for 3 years; Licence revoked; Wanted for fraud." },
          startDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          endDate: { type: ["string", "null"], description: "YYYY-MM-DD, when the debarment or sanction ends" },
          reference: { type: ["string", "null"], description: "Case, notice or reference number" },
        },
      },
    },
  },
} as const;

export function systemPrompt(sourceKey: RiskListKey): string {
  const source = riskListSource(sourceKey)!;
  return `You read official publications of the ${source.authority} (Kenya) for an anti-money-laundering risk list: "${source.label}".

Extract every person or organisation the publication names as subject to an enforcement action, sanction, debarment, disqualification, licence revocation, conviction, forfeiture, warning or wanted notice. For each: their name as printed (drop honorifics), any other names or trading names, whether a person or an organisation, why they are listed, the action taken, dates and the reference number.

Do not extract: officers of the authority, judges, advocates, witnesses, victims, or organisations only mentioned in passing. Use null when a field isn't stated. Never guess.`;
}

export async function extractRiskEntries(client: Anthropic, sourceKey: RiskListKey, document: { pdfBase64?: string; text?: string }, label: string): Promise<ExtractedRiskEntry[]> {
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = document.pdfBase64
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } },
        { type: "text", text: `Publication: ${label}. Extract the listed persons and organisations.` },
      ]
    : [{ type: "text", text: `Publication: ${label}.\n\n<publication>\n${(document.text ?? "").slice(0, 400_000)}\n</publication>\n\nExtract the listed persons and organisations.` }];
  const response = await client.beta.messages.parse({
    model: RISK_LIST_MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(SCHEMA) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(sourceKey),
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("The extraction was declined");
  const parsed = response.parsed_output as { entries: ExtractedRiskEntry[] } | null;
  if (!parsed) throw new Error(response.stop_reason === "max_tokens" ? "The publication is too long to read in one go; split it." : "No structured output");
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  return parsed.entries
    .filter((entry) => entry.name.trim().length > 2 && entry.reason.trim())
    .map((entry) => ({
      name: entry.name.trim().replace(/\s+/g, " ").slice(0, 200),
      aliases: entry.aliases.map((alias) => alias.trim()).filter(Boolean).slice(0, 10),
      entityType: entry.entityType === "entity" ? ("entity" as const) : ("individual" as const),
      reason: entry.reason.trim().slice(0, 500),
      action: entry.action?.trim().slice(0, 200) || null,
      startDate: date(entry.startDate),
      endDate: date(entry.endDate),
      reference: entry.reference?.trim().slice(0, 100) || null,
    }))
    .slice(0, 2000);
}

// ── Fetching one public page ───────────────────────────────────────────────

export const FETCH_USER_AGENT = "SentinelRiskLists/1.0 (+https://sentinel.deeptrack.io; compliance@deeptrack.io)";

// Whether robots.txt lets Sentinel fetch `path` (rules for our agent or *).
export function robotsAllows(robots: string, path: string, agent = "SentinelRiskLists"): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((group) => group.agents.some((name) => name !== "*" && agent.toLowerCase().includes(name)));
  const applicable = mine.length ? mine : groups.filter((group) => group.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
      if (new RegExp(`^${pattern}`).test(path) && (!best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow))) {
        best = { allow: rule.allow, length: rule.path.length };
      }
    }
  }
  return best ? best.allow : true;
}

// The page must be https and on one of the source's official domains.
export function allowedPageUrl(sourceKey: RiskListKey, value: string): URL | null {
  const source = riskListSource(sourceKey);
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !source) return null;
    const host = url.hostname.toLowerCase();
    return source.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url : null;
  } catch {
    return null;
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br|table)>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ── CSV ────────────────────────────────────────────────────────────────────

// Columns: name, entity_type (individual|entity), reason (required); action,
// start_date, end_date, reference, aliases (; separated).
export function parseRiskCsv(csv: string): { rows: ExtractedRiskEntry[]; errors: string[] } {
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
  if (column("name") < 0 || column("entity_type") < 0 || column("reason") < 0) return { rows: [], errors: ["The header needs name, entity_type and reason columns."] };
  const date = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const rows: ExtractedRiskEntry[] = [];
  const errors: string[] = [];
  lines.slice(1, 20_001).forEach((line, index) => {
    const cells = split(line);
    const get = (name: string) => (column(name) >= 0 ? cells[column(name)]?.trim() || undefined : undefined);
    const type = get("entity_type")?.toLowerCase();
    if (!get("name") || !get("reason")) return void errors.push(`Line ${index + 2}: name and reason are required.`);
    if (type !== "individual" && type !== "entity") return void errors.push(`Line ${index + 2}: entity_type must be individual or entity.`);
    rows.push({
      name: get("name")!.slice(0, 200),
      aliases: (get("aliases") ?? "").split(";").map((alias) => alias.trim()).filter(Boolean).slice(0, 10),
      entityType: type,
      reason: get("reason")!.slice(0, 500),
      action: get("action")?.slice(0, 200) ?? null,
      startDate: date(get("start_date")),
      endDate: date(get("end_date")),
      reference: get("reference")?.slice(0, 100) ?? null,
    });
  });
  return { rows, errors: errors.slice(0, 50) };
}
