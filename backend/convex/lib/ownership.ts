import type { BrsLookup, BrsShareholder } from "./kenyaBrs";
import { normalizeRegistrationNumber } from "./kybChecks";
import { nameMatchScore } from "./documentChecks";

// Beneficial ownership from the Kenya BRS register (kybNode.processKyb):
// follows company shareholders through their own BRS records and works out
// each person's effective share. Kenya's Companies (Beneficial Ownership
// Information) Regulations use 10% of shares or voting rights.

export const UBO_THRESHOLD_PCT = 10;
export const MAX_OWNERSHIP_DEPTH = 3;
export const MAX_EXTRA_LOOKUPS = 6;

export type OwnershipNode = {
  name: string;
  kind: "person" | "company";
  idType: string | null;
  registrationNumber: string | null;
  depth: number; // 1 = holds the business directly
  path: string[]; // companies between the business and this holder
  directPct: number | null; // of the company it holds shares in
  effectivePct: number | null; // of the business
  resolved: boolean; // for companies: their own shareholders were found
  note: string | null;
};

export type OwnershipTree = {
  nodes: OwnershipNode[];
  beneficialOwners: OwnershipNode[]; // people at or above the threshold
  untraced: OwnershipNode[]; // companies whose owners couldn't be found
  sharesKnown: boolean; // every share count could be read
};

// "500 ORDINARY", "1,000 Ordinary shares", "50%" -> a number of shares or
// a percentage; null when unreadable.
export function parseShares(value: string | null | undefined): { amount: number; percent: boolean } | null {
  if (!value) return null;
  const percent = /(\d+(?:\.\d+)?)\s*%/.exec(value);
  if (percent) return { amount: Number(percent[1]), percent: true };
  const number = /(\d[\d,]*(?:\.\d+)?)/.exec(value);
  if (!number) return null;
  const amount = Number(number[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? { amount, percent: false } : null;
}

const COMPANY_WORDS = /\b(LIMITED|LTD|PLC|LLC|LLP|INC|CORPORATION|CORP|HOLDINGS|COMPANY|CO\.?|TRUST|FOUNDATION|FUND|SACCO|GROUP|PARTNERS|ENTERPRISES|INVESTMENTS?|VENTURES)\b/i;
const REGISTRATION_NUMBER = /^(PVT|CPR|C|BN|CR|LLP|PF|PUB|CLG|FC)[-/. ]?[A-Z0-9]/i;

export function isCompanyHolder(holder: Pick<BrsShareholder, "name" | "idType" | "idNumber">): boolean {
  if (holder.idType && /company|corporate|body|entity|organisation|organization|trust|partnership/i.test(holder.idType)) return true;
  if (holder.idType && /citizen|resident|alien|visitor|foreign(er)?|passport|national|individual|person/i.test(holder.idType)) return false;
  if (holder.idNumber && REGISTRATION_NUMBER.test(holder.idNumber.trim())) return true;
  return COMPANY_WORDS.test(holder.name);
}

// Each holder's share of its company, as a percentage.
function shareOfCompany(holders: BrsShareholder[]): Array<number | null> {
  const parsed = holders.map((holder) => parseShares(holder.shares));
  if (parsed.some((share) => share?.percent)) return parsed.map((share) => (share?.percent ? share.amount : null));
  const total = parsed.reduce((sum, share) => sum + (share?.amount ?? 0), 0);
  if (total <= 0) return parsed.map(() => null);
  return parsed.map((share) => (share ? Math.round((share.amount / total) * 10000) / 100 : null));
}

// Builds the tree from the business's own record and the records found for
// company shareholders (keyed by normalized registration number).
export function buildOwnership(root: BrsLookup, companies: Map<string, BrsLookup>): OwnershipTree {
  const nodes: OwnershipNode[] = [];
  let sharesKnown = true;
  const visit = (holders: BrsShareholder[], depth: number, path: string[], parentPct: number | null, seen: Set<string>) => {
    const shares = shareOfCompany(holders);
    holders.forEach((holder, index) => {
      const directPct = shares[index];
      if (directPct === null) sharesKnown = false;
      const effectivePct = directPct === null || parentPct === null ? null : Math.round(((directPct * parentPct) / 100) * 100) / 100;
      const company = isCompanyHolder(holder);
      const registrationNumber = company && holder.idNumber ? holder.idNumber.trim() : null;
      const key = registrationNumber ? normalizeRegistrationNumber(registrationNumber) : null;
      const record = key ? companies.get(key) : undefined;
      const node: OwnershipNode = {
        name: holder.name,
        kind: company ? "company" : "person",
        idType: holder.idType,
        registrationNumber,
        depth,
        path,
        directPct,
        effectivePct,
        resolved: false,
        note: null,
      };
      nodes.push(node);
      if (!company) return;
      if (key && seen.has(key)) {
        node.note = "Circular ownership: this company appears above itself.";
        return;
      }
      if (depth >= MAX_OWNERSHIP_DEPTH && !record) {
        node.note = `Traced ${MAX_OWNERSHIP_DEPTH} levels; deeper owners weren't looked up.`;
      } else if (record?.status === "found" && record.record.shareholders.length) {
        node.resolved = true;
        if (depth < MAX_OWNERSHIP_DEPTH) visit(record.record.shareholders, depth + 1, [...path, holder.name], effectivePct, new Set([...seen, ...(key ? [key] : [])]));
        else node.note = `Traced ${MAX_OWNERSHIP_DEPTH} levels; deeper owners weren't looked up.`;
      } else {
        node.note = !registrationNumber
          ? "No registration number on the register, so its owners couldn't be looked up."
          : record?.status === "not_found"
            ? "Not found in BRS (possibly a foreign company)."
            : record
              ? "Its BRS record couldn't be read."
              : "Not looked up (lookup limit reached).";
      }
    });
  };
  if (root.status === "found") visit(root.record.shareholders, 1, [], 100, new Set([normalizeRegistrationNumber(root.record.registrationNumber ?? "")]));
  const beneficialOwners = nodes.filter((node) => node.kind === "person" && (node.effectivePct === null || node.effectivePct >= UBO_THRESHOLD_PCT));
  const untraced = nodes.filter((node) => node.kind === "company" && !node.resolved && (node.effectivePct === null || node.effectivePct >= UBO_THRESHOLD_PCT));
  return { nodes, beneficialOwners, untraced, sharesKnown };
}

// Company shareholders to look up next, in order of size, within the limit.
export function companiesToLookUp(root: BrsLookup, done: Set<string>, limit = MAX_EXTRA_LOOKUPS): string[] {
  if (root.status !== "found") return [];
  const shares = shareOfCompany(root.record.shareholders);
  return root.record.shareholders
    .map((holder, index) => ({ holder, pct: shares[index] ?? 0 }))
    .filter(({ holder }) => isCompanyHolder(holder) && holder.idNumber)
    .sort((left, right) => right.pct - left.pct)
    .map(({ holder }) => holder.idNumber!.trim())
    .filter((number) => !done.has(normalizeRegistrationNumber(number)))
    .slice(0, limit);
}

// Beneficial owners the client didn't declare.
export function undeclaredOwners(tree: OwnershipTree, declared: string[]): OwnershipNode[] {
  return tree.beneficialOwners.filter((owner) => !declared.some((person) => nameMatchScore(person, owner.name) >= 0.67));
}

// Looks up company shareholders level by level (largest first), within the
// depth and lookup limits. `lookup` is the BRS call.
export async function traceOwnership(root: BrsLookup, lookup: (registrationNumber: string) => Promise<BrsLookup>, limits = { depth: MAX_OWNERSHIP_DEPTH, lookups: MAX_EXTRA_LOOKUPS }): Promise<Map<string, BrsLookup>> {
  const found = new Map<string, BrsLookup>();
  if (root.status === "found" && root.record.registrationNumber) found.set(normalizeRegistrationNumber(root.record.registrationNumber), root);
  let level: BrsLookup[] = [root];
  let used = 0;
  for (let depth = 1; depth < limits.depth && used < limits.lookups && level.length; depth++) {
    const numbers = [...new Set(level.flatMap((record) => companiesToLookUp(record, new Set(found.keys()), limits.lookups)))].slice(0, limits.lookups - used);
    if (!numbers.length) break;
    used += numbers.length;
    const results = await Promise.all(numbers.map(async (number) => [number, await lookup(number).catch((): BrsLookup => ({ status: "error", message: "lookup failed" }))] as const));
    for (const [number, result] of results) found.set(normalizeRegistrationNumber(number), result);
    level = results.map(([, result]) => result);
  }
  return found;
}
