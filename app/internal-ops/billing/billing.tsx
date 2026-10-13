"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { BarChart3, Download, FileText, Printer, Receipt, Tags, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Panel,
  PanelHeader,
  Row,
  SentinelCanvas,
  SkeletonBlock,
  StatTile,
  TopBar,
} from "@/components/sentinel/ui";
import { PLAN_LABELS, formatNumber, typeLabel, type Plan } from "@/components/sentinel/format";

type Prices = Partial<Record<Plan, number>>;

type BillingOverview = {
  pricing: { currency: string; pricePerCredit: Prices; updatedAt: number } | null;
  monthStarts: number[];
  totalsByMonth: Array<{ monthStart: number; credits: number; revenue: number | null }>;
  clients: Array<{
    _id: string;
    name: string;
    plan: Plan;
    status: string;
    balance: number;
    creditsByMonth: number[];
    revenueByMonth: number[] | null;
    usedLast14Days: number;
    daysLeft: number | null;
  }>;
  lowBalance: Array<{ _id: string; name: string; plan: Plan; balance: number; usedLast14Days: number; daysLeft: number | null }>;
  unbilled: Array<{ reviewId: string; clientName: string; reference: string; type: string; credits: number; amount: number | null; openedAt: number }>;
  unbilledCredits: number;
};

type Statement = {
  client: { name: string; plan: Plan };
  currency: string | null;
  pricePerCredit: number | null;
  lines: Array<{ createdAt: number; type: string; amount: number; reason: string; reference: string | null; verificationType: string | null }>;
  totals: { creditsUsed: number; added: number; amountDue: number | null };
  truncated: boolean;
};

const MONTHS = 6;
const PLANS: Plan[] = ["trial", "starter", "growth", "enterprise"];

function monthStartsEndingAt(now: number, count: number): number[] {
  const date = new Date(now);
  return Array.from({ length: count }, (_, index) =>
    new Date(date.getFullYear(), date.getMonth() - (count - 1 - index), 1).getTime(),
  );
}

function monthLabel(start: number) {
  return new Date(start).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function change(current: number, previous: number) {
  if (previous === 0) return current > 0 ? "new" : "—";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function Billing({ canWrite }: { canWrite: boolean }) {
  const bounds = useTimeBoundaries();
  const monthStarts = useMemo(() => (bounds ? monthStartsEndingAt(bounds.now, MONTHS) : null), [bounds]);
  const data = useAuthedQuery(
    anyApi.backOfficeBilling.overview,
    bounds && monthStarts ? { now: bounds.now, monthStarts } : "skip",
  ) as BillingOverview | undefined;

  const currency = data?.pricing?.currency ?? null;
  const thisMonth = data ? data.totalsByMonth.at(-1) : undefined;
  const lastMonth = data ? data.totalsByMonth.at(-2) : undefined;
  const runningOut = data?.lowBalance.filter((client) => (client.daysLeft ?? Infinity) <= 7).length ?? 0;
  const unbilledAmount = data?.unbilled.every((row) => row.amount !== null)
    ? data.unbilled.reduce((sum, row) => sum + (row.amount ?? 0), 0)
    : null;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Revenue &amp; billing</h1>
        <span className="text-[11px] text-sentinel-subtle">
          {currency ? `Prices in ${currency}` : "Prices not set: showing credits only"}
        </span>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined || !monthStarts ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-64" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5">
              <StatTile
                label="Credits used this month"
                value={formatNumber(thisMonth?.credits ?? 0)}
                note={lastMonth ? `${change(thisMonth?.credits ?? 0, lastMonth.credits)} vs last month` : undefined}
              />
              <StatTile
                label="Revenue this month"
                value={thisMonth?.revenue !== null && thisMonth?.revenue !== undefined ? money(thisMonth.revenue, currency) : "—"}
                note={currency ? "usage × current plan price" : "set prices below"}
                tone="blue"
              />
              <StatTile
                label="Running out within 7 days"
                value={formatNumber(runningOut)}
                note="at their last 14 days' rate"
                tone={runningOut > 0 ? "red" : undefined}
              />
              <StatTile
                label="Unbilled work"
                value={formatNumber(data.unbilledCredits)}
                note={unbilledAmount !== null && currency ? `credits · ${money(unbilledAmount, currency)}` : "credits held in review"}
                tone={data.unbilledCredits > 0 ? "amber" : undefined}
              />
            </div>

            <Panel>
              <PanelHeader icon={BarChart3} title="Usage by month" hint={currency ? `credits · revenue in ${currency}` : "credits"} />
              <MonthlyBars totals={data.totalsByMonth} currency={currency} />
            </Panel>

            <Panel>
              <PanelHeader icon={Receipt} title="Revenue by client" hint="this month vs last month" />
              <DataTable
                head={["Client", "Plan", "This month", "Last month", "Change", "Revenue this month", "Balance"]}
                empty={data.clients.length === 0 ? <EmptyState>No client accounts yet.</EmptyState> : null}
              >
                {data.clients.map((client) => {
                  const current = client.creditsByMonth.at(-1) ?? 0;
                  const previous = client.creditsByMonth.at(-2) ?? 0;
                  return (
                    <Row key={client._id}>
                      <Cell>{client.name}</Cell>
                      <Cell className="text-sentinel-muted">{PLAN_LABELS[client.plan]}</Cell>
                      <Cell>{formatNumber(current)}</Cell>
                      <Cell className="text-sentinel-muted">{formatNumber(previous)}</Cell>
                      <Cell className="text-sentinel-muted">{change(current, previous)}</Cell>
                      <Cell>{money(client.revenueByMonth?.at(-1) ?? null, currency)}</Cell>
                      <Cell className="text-sentinel-muted">{formatNumber(client.balance)}</Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={TrendingDown} title="Low balance forecast" hint="active clients within 14 days of running out" />
                <DataTable
                  head={["Client", "Balance", "Used, last 14 days", "Runs out"]}
                  empty={data.lowBalance.length === 0 ? <EmptyState>No active client is within 14 days of running out.</EmptyState> : null}
                >
                  {data.lowBalance.map((client) => (
                    <Row key={client._id}>
                      <Cell>{client.name}</Cell>
                      <Cell>{formatNumber(client.balance)}</Cell>
                      <Cell className="text-sentinel-muted">{formatNumber(client.usedLast14Days)}</Cell>
                      <Cell>
                        <Badge tone={(client.daysLeft ?? 99) <= 7 ? "red" : "amber"}>
                          {client.daysLeft === 0 ? "now" : `in ~${client.daysLeft} day${client.daysLeft === 1 ? "" : "s"}`}
                        </Badge>
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={FileText} title="Unbilled work" hint="charged when the review is resolved" />
                <DataTable
                  head={["Client", "Scan ID", "Type", "Credits", "Amount", "Open since"]}
                  empty={data.unbilled.length === 0 ? <EmptyState>Nothing waiting to be billed.</EmptyState> : null}
                >
                  {data.unbilled.map((row) => (
                    <Row key={row.reviewId}>
                      <Cell>{row.clientName}</Cell>
                      <Cell className="font-mono text-[11px] text-sentinel-muted">{row.reference}</Cell>
                      <Cell className="text-sentinel-muted">{typeLabel(row.type)}</Cell>
                      <Cell>{formatNumber(row.credits)}</Cell>
                      <Cell>{money(row.amount, currency)}</Cell>
                      <Cell className="text-sentinel-muted">
                        <ClientDate value={row.openedAt} format="MMM d" />
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>
            </div>

            <div className="grid gap-3.5 lg:grid-cols-[1fr_2fr]">
              <PricingPanel pricing={data.pricing} canWrite={canWrite} />
              <StatementPanel clients={data.clients} monthStarts={data.monthStarts} />
            </div>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}

function MonthlyBars({ totals, currency }: { totals: BillingOverview["totalsByMonth"]; currency: string | null }) {
  const max = Math.max(1, ...totals.map((row) => row.credits));
  return (
    <div className="flex items-end gap-3 px-4 pb-3 pt-5" role="img" aria-label="Credits used per month">
      {totals.map((row) => (
        <div key={row.monthStart} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[11px] font-medium">{formatNumber(row.credits)}</span>
          <div className="flex h-28 w-full items-end">
            <div
              className="w-full rounded-t bg-sentinel-blue"
              style={{ height: `${Math.max(2, (row.credits / max) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-sentinel-subtle">{monthLabel(row.monthStart)}</span>
          {currency && row.revenue !== null ? (
            <span className="text-[10px] text-sentinel-muted">{money(row.revenue, currency)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PricingPanel({ pricing, canWrite }: { pricing: BillingOverview["pricing"]; canWrite: boolean }) {
  const setPricing = useMutation(anyApi.backOfficeBilling.setPricing);
  const [currency, setCurrency] = useState(pricing?.currency ?? "KES");
  const [prices, setPrices] = useState<Record<Plan, string>>(() =>
    Object.fromEntries(PLANS.map((plan) => [plan, pricing?.pricePerCredit[plan]?.toString() ?? ""])) as Record<Plan, string>,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrency(pricing?.currency ?? "KES");
    setPrices(Object.fromEntries(PLANS.map((plan) => [plan, pricing?.pricePerCredit[plan]?.toString() ?? ""])) as Record<Plan, string>);
  }, [pricing]);

  async function save() {
    setSaving(true);
    try {
      const pricePerCredit: Prices = {};
      for (const plan of PLANS) {
        const raw = prices[plan].trim();
        if (raw) pricePerCredit[plan] = Number(raw);
      }
      await setPricing({ currency, pricePerCredit });
      toast.success("Prices saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not save prices."));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text disabled:opacity-60";

  return (
    <Panel>
      <PanelHeader icon={Tags} title="Price per credit" hint={pricing ? "used for all revenue figures" : "not set yet"} />
      <div className="space-y-2.5 p-3.5 text-[12px]">
        <label className="block">
          <span className="text-sentinel-subtle">Currency</span>
          <input className={inputClass} value={currency} maxLength={3} disabled={!canWrite} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </label>
        {PLANS.map((plan) => (
          <label key={plan} className="block">
            <span className="text-sentinel-subtle">{PLAN_LABELS[plan]}</span>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="not set"
              value={prices[plan]}
              disabled={!canWrite}
              onChange={(event) => setPrices((current) => ({ ...current, [plan]: event.target.value }))}
            />
          </label>
        ))}
        {canWrite ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded bg-sentinel-blue px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            Save prices
          </button>
        ) : (
          <p className="text-[11px] text-sentinel-subtle">Only internal administrators can change prices.</p>
        )}
        <p className="text-[10px] text-sentinel-subtle">
          Revenue uses each client&apos;s current plan price for every month shown; changes are audited.
        </p>
      </div>
    </Panel>
  );
}

function StatementPanel({ clients, monthStarts }: { clients: BillingOverview["clients"]; monthStarts: number[] }) {
  const [clientId, setClientId] = useState(clients[0]?._id ?? "");
  const [monthIndex, setMonthIndex] = useState(monthStarts.length - 1);
  const from = monthStarts[monthIndex];
  const to = monthIndex + 1 < monthStarts.length ? monthStarts[monthIndex + 1] : new Date(new Date(from).getFullYear(), new Date(from).getMonth() + 1, 1).getTime();
  const statement = useAuthedQuery(anyApi.backOfficeBilling.statement, clientId ? { clientId, from, to } : "skip") as
    | Statement
    | null
    | undefined;

  function downloadCsv() {
    if (!statement) return;
    const header = ["Date", "Type", "Credits", "Scan ID", "Verification type", "Reason"];
    const lines = statement.lines.map((line) => [
      new Date(line.createdAt).toISOString(),
      line.type,
      line.amount,
      line.reference,
      line.verificationType,
      line.reason,
    ]);
    const summary = [
      [],
      ["Credits used", statement.totals.creditsUsed],
      ["Price per credit", statement.pricePerCredit ?? ""],
      ["Amount due", statement.totals.amountDue ?? ""],
      ["Currency", statement.currency ?? ""],
    ];
    const csv = [header, ...lines, ...summary].map((row) => row.map((value) => csvCell(value as string | number | null)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `statement-${statement.client.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${monthLabel(from).replace(" ", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const selectClass = "rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text";

  return (
    <Panel>
      <PanelHeader
        icon={FileText}
        title="Monthly statement"
        action={
          <div className="flex items-center gap-2 print:hidden">
            <select className={selectClass} value={clientId} onChange={(event) => setClientId(event.target.value)} aria-label="Client">
              {clients.map((client) => (
                <option key={client._id} value={client._id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select className={selectClass} value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))} aria-label="Month">
              {monthStarts.map((start, index) => (
                <option key={start} value={index}>
                  {monthLabel(start)}
                </option>
              ))}
            </select>
            <button type="button" onClick={downloadCsv} disabled={!statement} className="flex items-center gap-1 text-[11px] text-sentinel-blue-mid disabled:opacity-50">
              <Download className="h-3 w-3" aria-hidden="true" /> CSV
            </button>
            <button type="button" onClick={() => window.print()} disabled={!statement} className="flex items-center gap-1 text-[11px] text-sentinel-blue-mid disabled:opacity-50">
              <Printer className="h-3 w-3" aria-hidden="true" /> Print / PDF
            </button>
          </div>
        }
      />
      {statement === undefined ? (
        <SkeletonBlock className="m-3 h-24" />
      ) : statement === null ? (
        <EmptyState>Pick a client.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-6 px-3.5 py-2.5 text-[12px]">
            <span>
              <span className="text-sentinel-subtle">Client </span>
              {statement.client.name} ({PLAN_LABELS[statement.client.plan]})
            </span>
            <span>
              <span className="text-sentinel-subtle">Credits used </span>
              {formatNumber(statement.totals.creditsUsed)}
            </span>
            <span>
              <span className="text-sentinel-subtle">Amount due </span>
              {money(statement.totals.amountDue, statement.currency)}
            </span>
          </div>
          <DataTable
            head={["Date", "Type", "Credits", "Scan ID", "Reason"]}
            empty={statement.lines.length === 0 ? <EmptyState>No credit activity in this month.</EmptyState> : null}
          >
            {statement.lines.map((line, index) => (
              <Row key={`${line.createdAt}-${index}`}>
                <Cell className="text-sentinel-muted">
                  <ClientDate value={line.createdAt} format="MMM d, HH:mm" />
                </Cell>
                <Cell className="text-sentinel-muted capitalize">{line.type}</Cell>
                <Cell className={line.amount < 0 ? "text-sentinel-text" : "text-sentinel-green-text"}>{formatNumber(line.amount)}</Cell>
                <Cell className="font-mono text-[11px] text-sentinel-muted">{line.reference ?? "—"}</Cell>
                <Cell className="text-sentinel-muted">{line.reason}</Cell>
              </Row>
            ))}
          </DataTable>
        </>
      )}
    </Panel>
  );
}
