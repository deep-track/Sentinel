"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Building2, Plus, Search, Wallet, X } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Eyebrow,
  Panel,
  PanelHeader,
  Row,
  SentinelCanvas,
  SkeletonBlock,
  TopBar,
  UsageBar,
} from "@/components/sentinel/ui";
import {
  PLAN_LABELS,
  type ClientStatus,
  type Plan,
  clientStatusBadge,
  formatNumber,
} from "@/components/sentinel/format";
import type { ClientSummary } from "../overview/ops-overview";
import { PLAN_BONUS, PLAN_PREPAY, planCredits, type BillingCurrency } from "@/backend/convex/lib/pricing";

type ClientDetail = ClientSummary & {
  ledger: Array<{ _id: string; type: string; amount: number; reason: string; createdAt: number }>;
};

type Message = { tone: "ok" | "error"; text: string } | null;

const inputClass =
  "w-full rounded-md border border-sentinel-line bg-sentinel-bg px-2.5 py-1.5 text-[12px] text-sentinel-text placeholder:text-sentinel-subtle focus:border-sentinel-blue focus:outline-none disabled:opacity-50";
const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-sentinel-blue px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-sentinel-blue-mid disabled:cursor-not-allowed disabled:opacity-50";
const ghostButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-sentinel-line px-3 py-1.5 text-[12px] text-sentinel-muted transition-colors hover:border-sentinel-chip hover:text-sentinel-text";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[10px] font-medium uppercase tracking-[0.05em] text-sentinel-subtle">
        {label}
      </label>
      {children}
      {hint ? <span className="text-[10px] text-sentinel-subtle">{hint}</span> : null}
    </div>
  );
}

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={message.tone === "error" ? "text-[11px] text-sentinel-red-text" : "text-[11px] text-sentinel-green-text"}
    >
      {message.text}
    </p>
  );
}

export function ClientAccounts({ canWrite, initialClientId }: { canWrite: boolean; initialClientId: string | null }) {
  const bounds = useTimeBoundaries();
  const clients = useAuthedQuery(anyApi.admin.listClients, bounds ? { monthStart: bounds.monthStart } : "skip") as
    | ClientSummary[]
    | undefined;
  const [selectedId, setSelectedId] = useState<string | null>(initialClientId);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (clients ?? []).filter((client) => !needle || client.name.toLowerCase().includes(needle) || client._id === needle);
  }, [clients, search]);

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Client accounts</h1>
        <span className="text-[11px] text-sentinel-subtle">
          {clients ? `${clients.length} client${clients.length === 1 ? "" : "s"}` : "Loading…"}
          {canWrite ? "" : " · read only"}
        </span>
        <label className="ml-auto flex w-full max-w-[280px] items-center gap-2 rounded-md border border-sentinel-line bg-sentinel-surface px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-sentinel-subtle" aria-hidden="true" />
          <span className="sr-only">Search clients</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client name or id…"
            className="w-full bg-transparent text-[12px] placeholder:text-sentinel-subtle focus:outline-none"
          />
        </label>
        {canWrite ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New client
          </button>
        ) : null}
      </TopBar>

      <div className="grid flex-1 gap-3.5 px-5 py-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,1fr)]">
        <Panel className="self-start">
          <PanelHeader icon={Building2} title="All clients" hint="credit usage this month" />
          {clients === undefined ? (
            <div className="flex flex-col gap-2 p-3">
              {[0, 1, 2, 3].map((key) => (
                <SkeletonBlock key={key} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              head={["Client", "Plan", "Usage", "Balance", "Limit", "Status"]}
              empty={
                filtered.length === 0 ? (
                  <EmptyState>{clients.length === 0 ? "No clients yet." : "No clients match your search."}</EmptyState>
                ) : null
              }
            >
              {filtered.map((client) => {
                const status = clientStatusBadge(client.status);
                const selected = client._id === selectedId;
                return (
                  <Row
                    key={client._id}
                    onClick={() => {
                      setSelectedId(client._id);
                      setCreating(false);
                    }}
                  >
                    <Cell className={selected ? "text-sentinel-blue-mid" : undefined}>
                      <button
                        type="button"
                        className="text-left focus:outline-none focus-visible:underline"
                        aria-pressed={selected}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(client._id);
                          setCreating(false);
                        }}
                      >
                        {client.name}
                      </button>
                    </Cell>
                    <Cell className="text-sentinel-muted">{PLAN_LABELS[client.plan]}</Cell>
                    <Cell>
                      <div className="flex items-center gap-2">
                        <UsageBar pct={client.usagePct} thresholdPct={client.creditThresholdPct} label={`${client.name} usage`} />
                        <span className="text-[11px] text-sentinel-subtle">
                          {client.usagePct === null ? "—" : `${client.usagePct}%`}
                        </span>
                      </div>
                    </Cell>
                    <Cell className={client.balance <= 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>
                      {formatNumber(client.balance)}
                    </Cell>
                    <Cell className="text-sentinel-muted">{formatNumber(client.creditLimit)}</Cell>
                    <Cell>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Cell>
                  </Row>
                );
              })}
            </DataTable>
          )}
        </Panel>

        <div className="flex flex-col gap-3.5">
          {creating ? (
            <CreateClientPanel
              onClose={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setSelectedId(id);
              }}
            />
          ) : selectedId && bounds ? (
            <ClientDetailPanel
              key={selectedId}
              clientId={selectedId}
              monthStart={bounds.monthStart}
              canWrite={canWrite}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <Panel>
              <EmptyState>Select a client to view and manage its account.</EmptyState>
            </Panel>
          )}
        </div>
      </div>
    </SentinelCanvas>
  );
}

function ClientDetailPanel({
  clientId,
  monthStart,
  canWrite,
  onClose,
}: {
  clientId: string;
  monthStart: number;
  canWrite: boolean;
  onClose: () => void;
}) {
  const client = useAuthedQuery(anyApi.admin.getClient, { clientId, monthStart, ledgerLimit: 15 }) as
    | ClientDetail
    | null
    | undefined;

  if (client === undefined) return <SkeletonBlock className="h-96 w-full" />;
  if (client === null) {
    return (
      <Panel>
        <EmptyState>Client not found.</EmptyState>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelHeader
          icon={Building2}
          title={client.name}
          action={
            <button type="button" onClick={onClose} className="text-sentinel-subtle hover:text-sentinel-text" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          }
        />
        <div className="grid grid-cols-2 gap-3 px-3.5 py-3 sm:grid-cols-4">
          <div>
            <Eyebrow>Balance</Eyebrow>
            <div className={client.balance <= 0 ? "text-[17px] font-semibold text-sentinel-red-text" : "text-[17px] font-semibold"}>
              {formatNumber(client.balance)}
            </div>
          </div>
          <div>
            <Eyebrow>Used this month</Eyebrow>
            <div className="text-[17px] font-semibold">{formatNumber(client.usedThisMonth)}</div>
          </div>
          <div>
            <Eyebrow>Plan limit</Eyebrow>
            <div className="text-[17px] font-semibold">{formatNumber(client.creditLimit)}</div>
          </div>
          <div>
            <Eyebrow>Client since</Eyebrow>
            <div className="text-[13px] text-sentinel-muted">
              <ClientDate value={client.createdAt} />
            </div>
          </div>
        </div>
        <div className="border-t border-sentinel-line px-3.5 py-2 font-mono text-[10px] text-sentinel-subtle">{client._id}</div>
      </Panel>

      {canWrite ? (
        <>
          <EditClientForm client={client} />
          <AdjustCreditsForm client={client} />
        </>
      ) : (
        <Panel>
          <EmptyState>Read-only access: an internal admin without the view-only role can edit clients.</EmptyState>
        </Panel>
      )}

      <Panel>
        <PanelHeader icon={Wallet} title="Credit ledger" hint="latest 15 entries" />
        <DataTable
          head={["When", "Type", "Amount", "Reason"]}
          empty={client.ledger.length === 0 ? <EmptyState>No ledger entries.</EmptyState> : null}
        >
          {client.ledger.map((entry) => (
            <Row key={entry._id}>
              <Cell className="text-sentinel-subtle">
                <ClientDate value={entry.createdAt} format="MMM d, HH:mm" />
              </Cell>
              <Cell className="text-sentinel-muted">{entry.type}</Cell>
              <Cell className={entry.amount < 0 ? "text-sentinel-red-text" : "text-sentinel-green-text"}>
                {entry.amount > 0 ? "+" : ""}
                {formatNumber(entry.amount)}
              </Cell>
              <Cell className="max-w-[260px] truncate text-sentinel-muted">
                <span title={entry.reason}>{entry.reason}</span>
              </Cell>
            </Row>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}

function EditClientForm({ client }: { client: ClientDetail }) {
  const updateClient = useMutation(anyApi.admin.updateClient);
  const [form, setForm] = useState({
    name: client.name,
    plan: client.plan,
    status: client.status,
    creditLimit: String(client.creditLimit),
    rpmCap: String(client.rpmCap),
    creditThresholdPct: String(client.creditThresholdPct),
    billingCurrency: client.billingCurrency,
    reason: "",
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  // Pick up changes saved elsewhere while the form is untouched.
  useEffect(() => {
    setForm((current) =>
      current.reason
        ? current
        : {
            ...current,
            name: client.name,
            plan: client.plan,
            status: client.status,
            creditLimit: String(client.creditLimit),
            rpmCap: String(client.rpmCap),
            creditThresholdPct: String(client.creditThresholdPct),
            billingCurrency: client.billingCurrency,
          },
    );
  }, [client.name, client.plan, client.status, client.creditLimit, client.rpmCap, client.creditThresholdPct, client.billingCurrency]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = (await updateClient({
        clientId: client._id,
        name: form.name,
        plan: form.plan,
        status: form.status,
        creditLimit: Number(form.creditLimit),
        rpmCap: Number(form.rpmCap),
        creditThresholdPct: Number(form.creditThresholdPct),
        billingCurrency: form.billingCurrency,
        reason: form.reason,
      })) as { changed: string[] };
      setMessage(
        result.changed.length
          ? { tone: "ok", text: `Saved: ${result.changed.join(", ")}.` }
          : { tone: "ok", text: "Nothing changed." },
      );
      setForm((current) => ({ ...current, reason: "" }));
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "Could not save the client.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Account settings" />
      <form onSubmit={save} className="grid grid-cols-1 gap-3 px-3.5 py-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name" htmlFor="client-name">
            <input id="client-name" className={inputClass} value={form.name} onChange={set("name")} maxLength={200} required />
          </Field>
        </div>
        <Field label="Plan" htmlFor="client-plan">
          <select id="client-plan" className={inputClass} value={form.plan} onChange={set("plan")}>
            {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
              <option key={plan} value={plan}>
                {PLAN_LABELS[plan]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="client-status" hint="Suspended or expired accounts can't start verifications.">
          <select id="client-status" className={inputClass} value={form.status} onChange={set("status")}>
            {(["active", "suspended", "trial_expired"] as ClientStatus[]).map((status) => (
              <option key={status} value={status}>
                {clientStatusBadge(status).label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing currency" htmlFor="client-currency" hint="Can only change while the balance is 0.">
          <select id="client-currency" className={inputClass} value={form.billingCurrency} onChange={set("billingCurrency")}>
            <option value="USD">USD — international price list</option>
            <option value="KES">KES — Kenyan price list</option>
          </select>
        </Field>
        <Field label="Monthly credit limit" htmlFor="client-limit" hint="Used for usage % and alerts. Doesn't add credits.">
          <input id="client-limit" type="number" min={0} step={1} className={inputClass} value={form.creditLimit} onChange={set("creditLimit")} required />
        </Field>
        <Field label="Alert threshold %" htmlFor="client-threshold">
          <input id="client-threshold" type="number" min={1} max={100} step={1} className={inputClass} value={form.creditThresholdPct} onChange={set("creditThresholdPct")} required />
        </Field>
        <Field label="Requests per minute" htmlFor="client-rpm">
          <input id="client-rpm" type="number" min={1} step={1} className={inputClass} value={form.rpmCap} onChange={set("rpmCap")} required />
        </Field>
        <Field label="Reason (audit log)" htmlFor="client-reason">
          <input id="client-reason" className={inputClass} value={form.reason} onChange={set("reason")} placeholder="e.g. Upgraded to Growth per contract" minLength={3} maxLength={500} required />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={buttonClass} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Notice message={message} />
        </div>
      </form>
    </Panel>
  );
}

const CREDIT_KINDS = [
  { value: "allocation", label: "Allocation (add plan credits)" },
  { value: "refund", label: "Refund (give credits back)" },
  { value: "adjustment", label: "Adjustment (add or remove)" },
] as const;

function AdjustCreditsForm({ client }: { client: ClientDetail }) {
  const adjustCredits = useMutation(anyApi.admin.adjustCredits);
  const [kind, setKind] = useState<(typeof CREDIT_KINDS)[number]["value"]>("allocation");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      setMessage({ tone: "error", text: "Enter a non-zero whole number." });
      return;
    }
    const verb = value > 0 ? `add ${formatNumber(value)}` : `remove ${formatNumber(-value)}`;
    if (!window.confirm(`${verb} credits ${value > 0 ? "to" : "from"} ${client.name}?`)) return;
    setPending(true);
    setMessage(null);
    try {
      const result = (await adjustCredits({ clientId: client._id, kind, amount: value, reason })) as { balance: number };
      setMessage({ tone: "ok", text: `Done. New balance: ${formatNumber(result.balance)} credits.` });
      setAmount("");
      setReason("");
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "Could not change credits.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader icon={Wallet} title="Add or adjust credits" hint={`balance ${formatNumber(client.balance)}`} />
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 px-3.5 py-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="credit-kind">
          <select id="credit-kind" className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {CREDIT_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" htmlFor="credit-amount" hint={kind === "adjustment" ? "Negative removes credits." : undefined}>
          <input
            id="credit-amount"
            type="number"
            step={1}
            min={kind === "adjustment" ? undefined : 1}
            className={inputClass}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="1000"
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason (audit log + ledger)" htmlFor="credit-reason">
            <input id="credit-reason" className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. October top-up, invoice INV-1042" minLength={3} maxLength={500} required />
          </Field>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={buttonClass} disabled={pending}>
            {pending ? "Applying…" : "Apply"}
          </button>
          <Notice message={message} />
        </div>
      </form>
    </Panel>
  );
}

function CreateClientPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const createClient = useMutation(anyApi.apiKeys.createClient);
  const [form, setForm] = useState({ name: "", plan: "trial" as Plan, billingCurrency: "KES" as BillingCurrency, creditLimit: "100", rpmCap: "60" });
  // Pre-fill the credits a paid plan's annual prepayment loads.
  useEffect(() => {
    if (form.plan !== "trial") setForm((current) => ({ ...current, creditLimit: String(planCredits(current.plan, current.billingCurrency)) }));
  }, [form.plan, form.billingCurrency]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const id = (await createClient({
        name: form.name,
        plan: form.plan,
        billingCurrency: form.billingCurrency,
        creditLimit: Number(form.creditLimit),
        rpmCap: Number(form.rpmCap),
      })) as string;
      onCreated(id);
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "Could not create the client.") });
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        icon={Plus}
        title="New client"
        action={
          <button type="button" onClick={onClose} className={ghostButtonClass}>
            Cancel
          </button>
        }
      />
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 px-3.5 py-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Organization name" htmlFor="new-client-name">
            <input id="new-client-name" className={inputClass} value={form.name} onChange={set("name")} maxLength={200} required />
          </Field>
        </div>
        <Field label="Plan" htmlFor="new-client-plan">
          <select id="new-client-plan" className={inputClass} value={form.plan} onChange={set("plan")}>
            {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
              <option key={plan} value={plan}>
                {PLAN_LABELS[plan]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing currency" htmlFor="new-client-currency" hint="Kenyan entities: KES. Everyone else: USD.">
          <select id="new-client-currency" className={inputClass} value={form.billingCurrency} onChange={set("billingCurrency")}>
            <option value="USD">USD — international price list</option>
            <option value="KES">KES — Kenyan price list</option>
          </select>
        </Field>
        <Field
          label="Starting credits / limit"
          htmlFor="new-client-limit"
          hint={
            form.plan === "trial"
              ? "Trial credits, allocated now."
              : `${PLAN_PREPAY[form.billingCurrency][form.plan].toLocaleString()} ${form.billingCurrency} prepay${PLAN_BONUS[form.billingCurrency][form.plan] ? ` + ${Math.round(PLAN_BONUS[form.billingCurrency][form.plan] * 100)}% bonus` : ""}.`
          }
        >
          <input id="new-client-limit" type="number" min={0} step={1} className={inputClass} value={form.creditLimit} onChange={set("creditLimit")} required />
        </Field>
        <Field label="Requests per minute" htmlFor="new-client-rpm">
          <input id="new-client-rpm" type="number" min={1} step={1} className={inputClass} value={form.rpmCap} onChange={set("rpmCap")} required />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={buttonClass} disabled={pending}>
            {pending ? "Creating…" : "Create client"}
          </button>
          <Notice message={message} />
        </div>
      </form>
    </Panel>
  );
}
