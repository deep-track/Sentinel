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
import {
  BILLING_CURRENCIES,
  CREDIT_VALUE,
  PLAN_BONUS,
  PLAN_PREPAY,
  SERVICE_LABELS,
  SERVICES,
  planCredits,
  priceList,
  type BillingCurrency,
} from "@/backend/convex/lib/pricing";

type Currency = BillingCurrency;

type BillingOverview = {
  pricing: { currency: "USD"; usdToKes: number | null; updatedAt: number | null };
  monthStarts: number[];
  totalsByMonth: Array<{ monthStart: number; credits: number; revenueByCurrency: Record<Currency, number>; revenue: number | null }>;
  clients: Array<{
    _id: string;
    name: string;
    plan: Plan;
    status: string;
    billingCurrency: Currency;
    balance: number;
    balanceValue: number;
    creditsByMonth: number[];
    revenueByMonth: number[];
    usedLast14Days: number;
    daysLeft: number | null;
  }>;
  lowBalance: Array<{ _id: string; name: string; plan: Plan; balance: number; usedLast14Days: number; daysLeft: number | null }>;
  unbilled: Array<{ reviewId: string; clientName: string; reference: string; type: string; credits: number; amount: number | null; currency: Currency; openedAt: number }>;
  unbilledCredits: number;
  unbilledByCurrency: Record<Currency, number>;
};

type Statement = {
  client: { name: string; plan: Plan; billingCurrency: Currency };
  currency: Currency;
  lines: Array<{ createdAt: number; type: string; amount: number; value: number; reason: string; reference: string | null; verificationType: string | null }>;
  totals: { creditsUsed: number; added: number; amountDue: number };
  truncated: boolean;
};

const MONTHS = 6;
const PAID_PLANS: Plan[] = ["starter", "growth", "business", "enterprise"];

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

  const thisMonth = data ? data.totalsByMonth.at(-1) : undefined;
  const lastMonth = data ? data.totalsByMonth.at(-2) : undefined;
  const runningOut = data?.lowBalance.filter((client) => (client.daysLeft ?? Infinity) <= 7).length ?? 0;
  const byCurrency = (amounts: Record<Currency, number> | undefined) =>
    amounts
      ? BILLING_CURRENCIES.filter((code) => amounts[code] > 0).map((code) => money(amounts[code], code)).join(" + ") || money(0, "USD")
      : "—";

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Revenue &amp; billing</h1>
        <span className="text-[11px] text-sentinel-subtle">
          USD and KES price lists · USD→KES {data?.pricing.usdToKes ?? "rate not set"}
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
                value={byCurrency(thisMonth?.revenueByCurrency)}
                note={thisMonth?.revenue !== null && thisMonth?.revenue !== undefined ? `≈ ${money(thisMonth.revenue, "USD")} combined` : "set the USD→KES rate for a combined total"}
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
                note={`credits · ${byCurrency(data.unbilledByCurrency)}`}
                tone={data.unbilledCredits > 0 ? "amber" : undefined}
              />
            </div>

            <Panel>
              <PanelHeader icon={BarChart3} title="Usage by month" hint="credits · combined revenue in USD" />
              <MonthlyBars totals={data.totalsByMonth} />
            </Panel>

            <Panel>
              <PanelHeader icon={Receipt} title="Revenue by client" hint="this month vs last month" />
              <DataTable
                head={["Client", "Plan", "Credits this month", "Last month", "Change", "Revenue this month", "Balance"]}
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
                      <Cell>{money(client.revenueByMonth.at(-1) ?? 0, client.billingCurrency)}</Cell>
                      <Cell className="text-sentinel-muted">
                        {formatNumber(client.balance)} · {money(client.balanceValue, client.billingCurrency)}
                      </Cell>
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
                      <Cell>{money(row.amount, row.currency)}</Cell>
                      <Cell className="text-sentinel-muted">
                        <ClientDate value={row.openedAt} format="MMM d" />
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </Panel>
            </div>

            <div className="grid gap-3.5 lg:grid-cols-[1fr_2fr]">
              <PricingPanel usdToKes={data.pricing.usdToKes} canWrite={canWrite} />
              <StatementPanel clients={data.clients} monthStarts={data.monthStarts} />
            </div>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}

function MonthlyBars({ totals }: { totals: BillingOverview["totalsByMonth"] }) {
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
          {row.revenue !== null ? <span className="text-[10px] text-sentinel-muted">{money(row.revenue, "USD")}</span> : null}
        </div>
      ))}
    </div>
  );
}

function PricingPanel({ usdToKes, canWrite }: { usdToKes: number | null; canWrite: boolean }) {
  const setExchangeRate = useMutation(anyApi.backOfficeBilling.setExchangeRate);
  const [currency, setCurrency] = useState<Currency>("KES");
  const [rate, setRate] = useState(usdToKes?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setRate(usdToKes?.toString() ?? ""), [usdToKes]);

  async function saveRate() {
    setSaving(true);
    try {
      await setExchangeRate({ usdToKes: Number(rate) });
      toast.success("Exchange rate saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not save the exchange rate."));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text disabled:opacity-60";

  return (
    <Panel>
      <PanelHeader
        icon={Tags}
        title="Price list"
        hint="lib/pricing.ts"
        action={
          <select
            className="rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px]"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            aria-label="Currency"
          >
            {BILLING_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        }
      />
      <div className="overflow-x-auto px-3.5 pt-2.5 text-[11px]">
        <table className="w-full">
          <thead className="text-sentinel-subtle">
            <tr>
              <th className="py-1 pr-2 text-left font-medium">Per check</th>
              {PAID_PLANS.map((plan) => (
                <th key={plan} className="py-1 pr-2 text-right font-medium">
                  {PLAN_LABELS[plan]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((service) => (
              <tr key={service} className="border-t border-sentinel-line">
                <td className="py-1 pr-2">{SERVICE_LABELS[service]}</td>
                {PAID_PLANS.map((plan) => {
                  const row = priceList(plan, currency).find((item) => item.service === service)!;
                  return (
                    <td key={plan} className="py-1 pr-2 text-right" title={`${row.credits} credit${row.credits === 1 ? "" : "s"}`}>
                      {money(row.amount, currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-sentinel-line text-sentinel-subtle">
              <td className="py-1 pr-2">Annual prepay → credits</td>
              {PAID_PLANS.map((plan) => (
                <td key={plan} className="py-1 pr-2 text-right">
                  {money(PLAN_PREPAY[currency][plan], currency)} → {formatNumber(planCredits(plan, currency))}
                  {PLAN_BONUS[currency][plan] ? ` (+${Math.round(PLAN_BONUS[currency][plan] * 100)}%)` : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-1.5 text-[10px] text-sentinel-subtle">
          1 credit = {money(CREDIT_VALUE[currency], currency)}. Prices shown are per check after any plan bonus; Trial uses
          Starter prices.
        </p>
      </div>
      <div className="space-y-2 p-3.5 text-[12px]">
        <label className="block">
          <span className="text-sentinel-subtle">USD → KES rate (for combined revenue only)</span>
          <input className={inputClass} inputMode="decimal" placeholder="e.g. 129" value={rate} disabled={!canWrite} onChange={(event) => setRate(event.target.value)} />
        </label>
        {canWrite ? (
          <button
            type="button"
            onClick={saveRate}
            disabled={saving || !rate.trim()}
            className="w-full rounded bg-sentinel-blue px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            Save rate
          </button>
        ) : (
          <p className="text-[11px] text-sentinel-subtle">Only internal administrators can change the rate.</p>
        )}
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
    const header = ["Date", "Type", "Credits", `Amount (${statement.currency})`, "Scan ID", "Verification type", "Reason"];
    const lines = statement.lines.map((line) => [
      new Date(line.createdAt).toISOString(),
      line.type,
      line.amount,
      line.value,
      line.reference,
      line.verificationType,
      line.reason,
    ]);
    const summary = [
      [],
      ["Credits used", statement.totals.creditsUsed],
      ["Amount", statement.totals.amountDue],
      ["Currency", statement.currency],
      ["Plan", statement.client.plan],
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
              <span className="text-sentinel-subtle">Amount </span>
              {money(statement.totals.amountDue, statement.currency)}
            </span>
          </div>
          <DataTable
            head={["Date", "Type", "Credits", "Amount", "Scan ID", "Reason"]}
            empty={statement.lines.length === 0 ? <EmptyState>No credit activity in this month.</EmptyState> : null}
          >
            {statement.lines.map((line, index) => (
              <Row key={`${line.createdAt}-${index}`}>
                <Cell className="text-sentinel-muted">
                  <ClientDate value={line.createdAt} format="MMM d, HH:mm" />
                </Cell>
                <Cell className="text-sentinel-muted capitalize">{line.type}</Cell>
                <Cell className={line.amount < 0 ? "text-sentinel-text" : "text-sentinel-green-text"}>{formatNumber(line.amount)}</Cell>
                <Cell className="text-sentinel-muted">{money(line.value, statement.currency)}</Cell>
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
