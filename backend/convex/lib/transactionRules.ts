// Transaction monitoring rules (transactions.ts): pure functions over one
// customer's transactions, so they can be tested without Convex. Amounts
// are compared in US dollars (KES converted at the Back Office rate).

export const CHANNELS = ["mpesa", "cash", "bank_transfer", "rtgs", "swift", "card", "cheque", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CURRENCIES = ["KES", "USD"] as const;
export type TxnCurrency = (typeof CURRENCIES)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  rtgs: "RTGS",
  swift: "SWIFT",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

export type Txn = {
  id: string;
  occurredAt: number;
  amount: number;
  currency: TxnCurrency;
  amountUsd: number;
  direction: "in" | "out";
  channel: Channel;
  counterpartyName: string | null;
  counterpartyCountry: string | null;
};

export const RULES = ["large_cash", "structuring", "velocity", "high_risk_country", "pass_through", "dormant_reactivated", "sanctioned_counterparty"] as const;
export type RuleKey = (typeof RULES)[number];

export const RULE_LABELS: Record<RuleKey, string> = {
  large_cash: "Large cash transaction",
  structuring: "Possible structuring",
  velocity: "Unusual activity for this customer",
  high_risk_country: "High-risk country",
  pass_through: "Money in and straight out",
  dormant_reactivated: "Dormant account reactivated",
  sanctioned_counterparty: "Counterparty on a sanctions or watch list",
};

export type MonitoringConfig = {
  // Cash at or above this is a large cash transaction to report.
  largeCashUsd: number;
  // Structuring: this many cash or M-Pesa transactions, each between
  // floorPct of the threshold and the threshold, within windowDays.
  structuringFloorPct: number;
  structuringMinCount: number;
  structuringWindowDays: number;
  // Velocity: the last 24 hours at least `multiple` times the customer's
  // usual daily volume (after 30+ days of history), and at least minUsd.
  velocityMultiple: number;
  velocityMinUsd: number;
  // Pass-through: outflows of at least pct of the inflows within hours.
  passThroughPct: number;
  passThroughHours: number;
  passThroughMinUsd: number;
  // Dormant: no transactions for this many days, then at least minUsd.
  dormantDays: number;
  dormantMinUsd: number;
  // FATF lists (riskSettings) and the client's home country.
  callForAction: string[];
  increasedMonitoring: string[];
  homeCountry: string;
};

export const DEFAULT_MONITORING: Omit<MonitoringConfig, "callForAction" | "increasedMonitoring" | "homeCountry"> = {
  largeCashUsd: 15_000,
  structuringFloorPct: 0.7,
  structuringMinCount: 3,
  structuringWindowDays: 7,
  velocityMultiple: 5,
  velocityMinUsd: 5_000,
  passThroughPct: 0.9,
  passThroughHours: 48,
  passThroughMinUsd: 10_000,
  dormantDays: 180,
  dormantMinUsd: 5_000,
};

// A client's own thresholds (Settings → Screening, stored as
// screening.transactionMonitoring), in the units the page shows: whole
// percentages, US dollars, days and hours.
export type MonitoringThresholds = {
  largeCashUsd: number;
  structuringPercent: number;
  structuringMinCount: number;
  structuringWindowDays: number;
  velocityMultiple: number;
  velocityMinUsd: number;
  passThroughPercent: number;
  passThroughHours: number;
  passThroughMinUsd: number;
  dormantDays: number;
  dormantMinUsd: number;
};

// Allowed values. Large cash can be lowered but not raised: US$15,000 is the
// reporting threshold set by law.
export const MONITORING_LIMITS: Record<keyof MonitoringThresholds, { min: number; max: number; label: string }> = {
  largeCashUsd: { min: 1_000, max: 15_000, label: "The large cash threshold (US$)" },
  structuringPercent: { min: 50, max: 95, label: "The structuring band (% of the cash threshold)" },
  structuringMinCount: { min: 2, max: 20, label: "The number of transactions for structuring" },
  structuringWindowDays: { min: 1, max: 30, label: "The structuring window (days)" },
  velocityMultiple: { min: 2, max: 50, label: "The velocity multiple" },
  velocityMinUsd: { min: 100, max: 1_000_000, label: "The velocity minimum (US$)" },
  passThroughPercent: { min: 50, max: 100, label: "The pass-through share (% of inflows)" },
  passThroughHours: { min: 1, max: 168, label: "The pass-through window (hours)" },
  passThroughMinUsd: { min: 100, max: 1_000_000, label: "The pass-through minimum (US$)" },
  dormantDays: { min: 30, max: 730, label: "The dormancy period (days)" },
  dormantMinUsd: { min: 100, max: 1_000_000, label: "The dormant reactivation minimum (US$)" },
};

export function thresholdsFromConfig(config: Omit<MonitoringConfig, "callForAction" | "increasedMonitoring" | "homeCountry"> = DEFAULT_MONITORING): MonitoringThresholds {
  return {
    largeCashUsd: config.largeCashUsd,
    structuringPercent: Math.round(config.structuringFloorPct * 100),
    structuringMinCount: config.structuringMinCount,
    structuringWindowDays: config.structuringWindowDays,
    velocityMultiple: config.velocityMultiple,
    velocityMinUsd: config.velocityMinUsd,
    passThroughPercent: Math.round(config.passThroughPct * 100),
    passThroughHours: config.passThroughHours,
    passThroughMinUsd: config.passThroughMinUsd,
    dormantDays: config.dormantDays,
    dormantMinUsd: config.dormantMinUsd,
  };
}

export function configFromThresholds(thresholds: MonitoringThresholds): Omit<MonitoringConfig, "callForAction" | "increasedMonitoring" | "homeCountry"> {
  return {
    largeCashUsd: thresholds.largeCashUsd,
    structuringFloorPct: thresholds.structuringPercent / 100,
    structuringMinCount: thresholds.structuringMinCount,
    structuringWindowDays: thresholds.structuringWindowDays,
    velocityMultiple: thresholds.velocityMultiple,
    velocityMinUsd: thresholds.velocityMinUsd,
    passThroughPct: thresholds.passThroughPercent / 100,
    passThroughHours: thresholds.passThroughHours,
    passThroughMinUsd: thresholds.passThroughMinUsd,
    dormantDays: thresholds.dormantDays,
    dormantMinUsd: thresholds.dormantMinUsd,
  };
}

export type Alert = { rule: RuleKey; severity: "high" | "medium"; summary: string; transactionIds: string[]; key: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function toUsd(amount: number, currency: TxnCurrency, usdToKes: number | null): number | null {
  if (currency === "USD") return amount;
  return usdToKes && usdToKes > 0 ? Math.round((amount / usdToKes) * 100) / 100 : null;
}

const money = (txns: Txn[]) => {
  const currency = txns[0]?.currency ?? "KES";
  const same = txns.every((txn) => txn.currency === currency);
  const total = same ? txns.reduce((sum, txn) => sum + txn.amount, 0) : txns.reduce((sum, txn) => sum + txn.amountUsd, 0);
  return `${same ? currency : "USD"} ${Math.round(total).toLocaleString("en-US")}`;
};

// Higher-risk customers are watched more closely: lower thresholds for
// the behavioural rules (the large cash threshold is set by law).
export function forRisk(config: MonitoringConfig, risk: string | null): MonitoringConfig {
  if (risk !== "high" && risk !== "prohibited") return config;
  return { ...config, velocityMinUsd: config.velocityMinUsd / 2, passThroughMinUsd: config.passThroughMinUsd / 2, dormantMinUsd: config.dormantMinUsd / 2, velocityMultiple: Math.max(2, config.velocityMultiple / 2) };
}

// Alerts raised by the new transactions, given the customer's history
// (all transactions, oldest first, including the new ones).
export function evaluateTransactions(history: Txn[], newIds: Set<string>, config: MonitoringConfig): Alert[] {
  const alerts: Alert[] = [];
  const fresh = history.filter((txn) => newIds.has(txn.id));
  if (!fresh.length) return alerts;
  const latest = Math.max(...fresh.map((txn) => txn.occurredAt));

  // 1. Large cash.
  for (const txn of fresh) {
    if (txn.channel === "cash" && txn.amountUsd >= config.largeCashUsd) {
      alerts.push({ rule: "large_cash", severity: "medium", summary: `Cash ${txn.direction === "in" ? "deposit" : "withdrawal"} of ${money([txn])}, at or above the US$${config.largeCashUsd.toLocaleString("en-US")} reporting threshold.`, transactionIds: [txn.id], key: `large_cash:${txn.id}` });
    }
  }

  // 2. Structuring: several transactions just under the threshold.
  const floor = config.largeCashUsd * config.structuringFloorPct;
  const nearThreshold = history.filter((txn) => (txn.channel === "cash" || txn.channel === "mpesa") && txn.amountUsd >= floor && txn.amountUsd < config.largeCashUsd && txn.occurredAt > latest - config.structuringWindowDays * DAY && txn.occurredAt <= latest);
  if (nearThreshold.length >= config.structuringMinCount && nearThreshold.some((txn) => newIds.has(txn.id)) && nearThreshold.reduce((sum, txn) => sum + txn.amountUsd, 0) >= config.largeCashUsd) {
    alerts.push({
      rule: "structuring",
      severity: "high",
      summary: `${nearThreshold.length} cash or M-Pesa transactions just under the reporting threshold within ${config.structuringWindowDays} days (${money(nearThreshold)} in total).`,
      transactionIds: nearThreshold.map((txn) => txn.id),
      key: `structuring:${Math.floor(latest / DAY)}`,
    });
  }

  // 3. Velocity against the customer's own usual volume.
  const firstAt = history[0]?.occurredAt ?? latest;
  if (latest - firstAt >= 30 * DAY) {
    const recent = history.filter((txn) => txn.occurredAt > latest - DAY && txn.occurredAt <= latest);
    const baseline = history.filter((txn) => txn.occurredAt <= latest - DAY && txn.occurredAt > latest - 91 * DAY);
    const baselineDays = Math.max(1, Math.min(90, (latest - DAY - Math.max(firstAt, latest - 91 * DAY)) / DAY));
    const usualDaily = baseline.reduce((sum, txn) => sum + txn.amountUsd, 0) / baselineDays;
    const recentTotal = recent.reduce((sum, txn) => sum + txn.amountUsd, 0);
    if (recentTotal >= config.velocityMinUsd && recentTotal >= config.velocityMultiple * Math.max(usualDaily, 1) && recent.some((txn) => newIds.has(txn.id))) {
      alerts.push({
        rule: "velocity",
        severity: "medium",
        summary: `${money(recent)} in 24 hours, ${usualDaily > 0 ? `${Math.round(recentTotal / usualDaily)} times` : "far above"} this customer's usual daily volume.`,
        transactionIds: recent.map((txn) => txn.id),
        key: `velocity:${Math.floor(latest / DAY)}`,
      });
    }
  }

  // 4. Counterparties in high-risk countries (FATF lists).
  for (const txn of fresh) {
    const country = (txn.counterpartyCountry ?? "").toUpperCase();
    if (!country || country === config.homeCountry) continue;
    if (config.callForAction.includes(country)) {
      alerts.push({ rule: "high_risk_country", severity: "high", summary: `${money([txn])} ${txn.direction === "in" ? "from" : "to"} ${country}, on the FATF call-for-action list.`, transactionIds: [txn.id], key: `country:${txn.id}` });
    } else if (config.increasedMonitoring.includes(country) && txn.amountUsd >= 1_000) {
      alerts.push({ rule: "high_risk_country", severity: "medium", summary: `${money([txn])} ${txn.direction === "in" ? "from" : "to"} ${country}, under FATF increased monitoring.`, transactionIds: [txn.id], key: `country:${txn.id}` });
    }
  }

  // 5. Pass-through: money in and straight back out (mule accounts).
  for (const txn of fresh.filter((item) => item.direction === "out")) {
    const window = history.filter((item) => item.occurredAt >= txn.occurredAt - config.passThroughHours * HOUR && item.occurredAt <= txn.occurredAt);
    const inflow = window.filter((item) => item.direction === "in");
    const outflow = window.filter((item) => item.direction === "out");
    const inUsd = inflow.reduce((sum, item) => sum + item.amountUsd, 0);
    const outUsd = outflow.reduce((sum, item) => sum + item.amountUsd, 0);
    if (inUsd >= config.passThroughMinUsd && outUsd >= config.passThroughPct * inUsd) {
      alerts.push({
        rule: "pass_through",
        severity: "high",
        summary: `${money(inflow)} came in and ${money(outflow)} went out within ${config.passThroughHours} hours (${Math.round((outUsd / inUsd) * 100)}%).`,
        transactionIds: window.map((item) => item.id),
        key: `pass_through:${Math.floor(txn.occurredAt / DAY)}`,
      });
      break;
    }
  }

  // 6. Dormant account reactivated.
  for (const txn of fresh) {
    const before = history.filter((item) => item.occurredAt < txn.occurredAt && !newIds.has(item.id));
    const previous = before[before.length - 1];
    if (previous && txn.occurredAt - previous.occurredAt >= config.dormantDays * DAY && txn.amountUsd >= config.dormantMinUsd) {
      alerts.push({ rule: "dormant_reactivated", severity: "medium", summary: `${money([txn])} after ${Math.floor((txn.occurredAt - previous.occurredAt) / DAY)} days without activity.`, transactionIds: [txn.id], key: `dormant:${txn.id}` });
      break;
    }
  }

  // One alert per key.
  const seen = new Set<string>();
  return alerts.filter((alert) => (seen.has(alert.key) ? false : (seen.add(alert.key), true)));
}

// An STR from an alert (alert page → Prepare STR): the alert's largest
// transaction (in US dollars) and its summary as the reason.
export function strFromAlert(
  alert: { rule: RuleKey; summary: string },
  txns: Array<Pick<Txn, "occurredAt" | "amount" | "currency" | "amountUsd" | "direction" | "channel" | "counterpartyName"> & { externalId: string; counterpartyAccount: string | null; narration: string | null }>,
) {
  const largest = txns.reduce<(typeof txns)[number] | null>((best, txn) => (!best || txn.amountUsd > best.amountUsd ? txn : best), null);
  return {
    reason: `${RULE_LABELS[alert.rule]}: ${alert.summary}`,
    transaction: largest
      ? {
          number: largest.externalId,
          occurredAt: largest.occurredAt,
          amount: largest.amount,
          description: `${CHANNEL_LABELS[largest.channel]} ${largest.direction === "in" ? "received" : "sent"}: ${largest.currency} ${largest.amount.toLocaleString("en-US")}${largest.narration ? ` (${largest.narration})` : ""}`.slice(0, 1000),
          counterpartyName: largest.counterpartyName ?? "",
          counterpartyAccount: largest.counterpartyAccount ?? "",
        }
      : null,
  };
}

export type RawTransaction = {
  externalId?: unknown;
  customerRef?: unknown;
  occurredAt?: unknown;
  amount?: unknown;
  currency?: unknown;
  direction?: unknown;
  channel?: unknown;
  counterpartyName?: unknown;
  counterpartyCountry?: unknown;
  counterpartyAccount?: unknown;
  narration?: unknown;
};

export type CleanTransaction = {
  externalId: string;
  customerRef: string;
  occurredAt: number;
  amount: number;
  currency: TxnCurrency;
  direction: "in" | "out";
  channel: Channel;
  counterpartyName: string | null;
  counterpartyCountry: string | null;
  counterpartyAccount: string | null;
  narration: string | null;
};

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

// Validates one transaction from the API or a CSV row.
export function cleanTransaction(raw: RawTransaction, now = Date.now()): CleanTransaction | { error: string } {
  const externalId = text(raw.externalId, 100);
  if (!externalId) return { error: "externalId is required" };
  const customerRef = text(raw.customerRef, 100);
  if (!customerRef) return { error: "customerRef is required" };
  const occurredAt = typeof raw.occurredAt === "number" ? raw.occurredAt : typeof raw.occurredAt === "string" ? Date.parse(raw.occurredAt) : NaN;
  if (!Number.isFinite(occurredAt) || occurredAt > now + DAY || occurredAt < Date.UTC(2000, 0, 1)) return { error: "occurredAt must be an ISO date-time or epoch milliseconds, not in the future" };
  const amount = typeof raw.amount === "number" ? raw.amount : typeof raw.amount === "string" ? Number(raw.amount.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return { error: "amount must be a positive number" };
  const currency = (text(raw.currency, 3) ?? "KES").toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(currency)) return { error: "currency must be KES or USD" };
  const direction = (text(raw.direction, 10) ?? "").toLowerCase();
  if (direction !== "in" && direction !== "out") return { error: "direction must be in or out" };
  const channel = (text(raw.channel, 20) ?? "other").toLowerCase().replace(/[\s-]/g, "_").replace(/^m_?pesa$/, "mpesa");
  if (!(CHANNELS as readonly string[]).includes(channel)) return { error: `channel must be one of ${CHANNELS.join(", ")}` };
  const country = text(raw.counterpartyCountry, 3)?.toUpperCase() ?? null;
  if (country && !/^[A-Z]{2}$/.test(country)) return { error: "counterpartyCountry must be a 2-letter ISO code" };
  return {
    externalId,
    customerRef,
    occurredAt,
    amount: Math.round(amount * 100) / 100,
    currency: currency as TxnCurrency,
    direction,
    channel: channel as Channel,
    counterpartyName: text(raw.counterpartyName, 200),
    counterpartyCountry: country,
    counterpartyAccount: text(raw.counterpartyAccount, 100),
    narration: text(raw.narration, 300),
  };
}

// CSV with a header row; quoted fields allowed.
export function parseTransactionCsv(csv: string): RawTransaction[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell.trim()));
  if (!header) return [];
  const keys = header.map((cell) => cell.trim());
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index]?.trim() ?? ""])) as RawTransaction);
}

export const CSV_TEMPLATE = "externalId,customerRef,occurredAt,amount,currency,direction,channel,counterpartyName,counterpartyCountry,counterpartyAccount,narration\nTX-0001,CUST-001,2026-10-16T09:30:00+03:00,150000,KES,in,mpesa,Jane Wanjiru,KE,0712345678,Payment for goods\n";
