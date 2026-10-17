// False-positive memory. When a reviewer clears an AML screening (approves
// it: the hits were not this customer), each hit is remembered for that
// customer. Later screenings and monitoring of the same customer don't
// raise it again, unless it has become more severe: a new risk category, a
// more senior PEP class, or critical. Only customers identified by more
// than a name are remembered, so clearing one "John Kamau" never hides
// hits on another.

export type RiskLevel = "critical" | "high";

export type ClearedHit = {
  key: string; // `${source}:${sourceRecordId}`, as in lib/amlMonitoringStore.ts
  entityName: string;
  categories: string[];
  pepClass?: number;
  riskLevel: RiskLevel;
  clearedAt: number;
  clearedByName?: string;
  reasonCode?: string;
};

export type CurrentHit = { categories: string[]; pepClass?: number | null; riskLevel: RiskLevel };

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .sort()
    .join(" ");
}

// The customer a screening is about, or null when it can't be told apart
// from other people with the same name.
export function subjectKeyFor(subject: {
  subjectName?: unknown;
  entityType?: unknown;
  country?: unknown;
  dateOfBirth?: unknown;
  idNumber?: unknown;
  registrationNumber?: unknown;
  externalRef?: unknown;
}): string | null {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null);
  const externalRef = text(subject.externalRef);
  if (externalRef) return `ref:${externalRef}`;
  const name = typeof subject.subjectName === "string" ? normalizeName(subject.subjectName) : "";
  if (!name) return null;
  const entity = subject.entityType === "entity";
  const identifier = entity ? text(subject.registrationNumber) : text(subject.idNumber) ?? text(subject.dateOfBirth);
  if (!identifier) return null;
  const kind = entity ? (text(subject.registrationNumber) ? "reg" : "x") : text(subject.idNumber) ? "id" : "dob";
  return `${entity ? "entity" : "person"}:${name}|${kind}:${identifier.replace(/\s+/g, "")}|${text(subject.country) ?? ""}`;
}

// True while a cleared hit still covers the current one: nothing about it
// has become more severe since it was cleared.
export function stillCleared(current: CurrentHit, cleared: Pick<ClearedHit, "categories" | "pepClass" | "riskLevel">): boolean {
  if (current.categories.some((category) => !cleared.categories.includes(category))) return false;
  if (current.pepClass && (!cleared.pepClass || current.pepClass < cleared.pepClass)) return false;
  return !(current.riskLevel === "critical" && cleared.riskLevel !== "critical");
}

export function hitKey(source: string, sourceRecordId: string): string {
  return `${source}:${sourceRecordId}`;
}
