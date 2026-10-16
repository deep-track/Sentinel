"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { FileUp, ListX, Loader2, Upload, UserPlus } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Badge, Panel, PanelHeader, SentinelCanvas, TopBar } from "@/components/sentinel/ui";
import { RISK_LIST_SOURCES, type RiskListKey } from "@/backend/convex/lib/riskLists";

// Back Office: Kenyan risk lists. Read a publication (upload, or one page
// on the authority's site), approve what it lists, import a CSV, or add by
// hand.

type Entry = { _id: string; sourceKey: RiskListKey; name: string; aliases: string[]; entityType: "individual" | "entity"; reason: string; action?: string; startDate?: string; endDate?: string; reference?: string; origin: string; originRef?: string };
type Proposal = { name: string; aliases: string[]; entityType: "individual" | "entity"; reason: string; action: string | null; startDate: string | null; endDate: string | null; reference: string | null };
type Data = {
  sources: Array<{ key: RiskListKey; label: string; authority: string; category: string; domains: string[]; count: number }>;
  entries: Entry[];
  imports: Array<{ _id: string; sourceKey: RiskListKey; label: string; url: string | null; status: "reading" | "ready" | "failed" | "approved"; error: string | null; createdAt: number; proposals: Proposal[] | null }>;
};

const inputClass = "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text disabled:opacity-60";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded bg-sentinel-blue px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-60";
const label = (key: string) => RISK_LIST_SOURCES.find((source) => source.key === key)?.label ?? key;

function SourceSelect({ value, onChange }: { value: RiskListKey; onChange: (key: RiskListKey) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as RiskListKey)}>
      {RISK_LIST_SOURCES.map((source) => (
        <option key={source.key} value={source.key}>
          {source.label}
        </option>
      ))}
    </select>
  );
}

export function RiskLists({ canWrite }: { canWrite: boolean }) {
  const [filter, setFilter] = useState<RiskListKey | "">("");
  const [search, setSearch] = useState("");
  const data = useAuthedQuery(anyApi.riskLists.list, { ...(filter ? { sourceKey: filter } : {}), ...(search ? { search } : {}) }) as Data | undefined;
  const remove = useMutation(anyApi.riskLists.remove);
  const total = data?.sources.reduce((sum, source) => sum + source.count, 0) ?? 0;

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Kenyan risk lists</h1>
        <span className="text-[11px] text-sentinel-subtle">
          {data ? `${total.toLocaleString("en-US")} active entries · screened in every AML check · World Bank, AfDB, Interpol and FRC come through OpenSanctions` : "Loading…"}
        </span>
      </TopBar>
      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(data?.sources ?? []).map((source) => (
            <button key={source.key} type="button" onClick={() => setFilter(filter === source.key ? "" : source.key)} className={`rounded border px-3 py-2 text-left text-[11px] ${filter === source.key ? "border-sentinel-blue" : "border-sentinel-line"}`}>
              <p className="font-medium">{source.label}</p>
              <p className="text-sentinel-subtle">
                {source.count.toLocaleString("en-US")} · {source.category === "special_interest" ? "Special interest" : "Fitness & probity"}
              </p>
            </button>
          ))}
        </div>
        {canWrite ? (
          <div className="grid gap-3.5 lg:grid-cols-3">
            <ReadPanel imports={data?.imports ?? []} />
            <ImportPanel />
            <AddPanel />
          </div>
        ) : null}
        <Panel>
          <PanelHeader icon={ListX} title={filter ? label(filter) : "All entries"} action={<input className={`${inputClass} w-56`} placeholder="Search name, reason, reference" value={search} onChange={(event) => setSearch(event.target.value)} />} />
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-left text-sentinel-subtle">
                <tr>
                  <th className="px-3.5 py-2 font-medium">Name</th>
                  <th className="px-3.5 py-2 font-medium">List</th>
                  <th className="px-3.5 py-2 font-medium">Reason and action</th>
                  <th className="px-3.5 py-2 font-medium">Dates</th>
                  <th className="px-3.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).map((entry) => (
                  <tr key={entry._id} className="border-t border-sentinel-line align-top">
                    <td className="px-3.5 py-2">
                      <p className="font-medium">{entry.name}</p>
                      <p className="text-sentinel-subtle">
                        {entry.entityType === "entity" ? "Organisation" : "Person"}
                        {entry.aliases.length ? ` · aka ${entry.aliases.join(", ")}` : ""}
                      </p>
                    </td>
                    <td className="px-3.5 py-2 text-sentinel-muted">{label(entry.sourceKey)}</td>
                    <td className="px-3.5 py-2">
                      {entry.reason}
                      {entry.action ? <span className="block text-sentinel-muted">{entry.action}</span> : null}
                      {entry.reference ? <span className="block text-sentinel-subtle">Ref. {entry.reference}</span> : null}
                    </td>
                    <td className="px-3.5 py-2 text-sentinel-muted">
                      {entry.startDate ?? "?"} – {entry.endDate ?? "open"}
                    </td>
                    <td className="px-3.5 py-2 text-right">
                      {canWrite ? (
                        <button
                          type="button"
                          className="text-sentinel-muted hover:underline"
                          onClick={() => {
                            if (!window.confirm(`Remove ${entry.name}? Screening stops matching them.`)) return;
                            void remove({ id: entry._id }).then(
                              () => toast.success("Removed"),
                              (error: unknown) => toast.error(getErrorMessage(error, "Couldn't remove the entry.")),
                            );
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.entries.length === 0 ? <p className="p-3.5 text-[12px] text-sentinel-subtle">No entries yet. Read a publication or import a CSV.</p> : null}
          </div>
        </Panel>
      </div>
    </SentinelCanvas>
  );
}

function ReadPanel({ imports }: { imports: Data["imports"] }) {
  const generateUploadUrl = useMutation(anyApi.riskLists.generateUploadUrl);
  const read = useMutation(anyApi.riskLists.read);
  const approve = useMutation(anyApi.riskLists.approve);
  const [sourceKey, setSourceKey] = useState<RiskListKey>("KE_PPRA_DEBARRED");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const domains = RISK_LIST_SOURCES.find((source) => source.key === sourceKey)?.domains ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      let storageId: string | undefined;
      let text: string | undefined;
      if (file) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const uploadUrl = (await generateUploadUrl({})) as string;
          const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
          if (!response.ok) throw new Error("Upload failed");
          storageId = ((await response.json()) as { storageId: string }).storageId;
        } else text = await file.text();
      }
      await read({ sourceKey, label: title, ...(storageId ? { storageId } : {}), ...(text ? { text } : {}), ...(!file && url ? { url } : {}) });
      toast.success("Reading. The names it lists appear below for approval.");
      setFile(null);
      setUrl("");
      setTitle("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't read the publication."));
    } finally {
      setBusy(false);
    }
  };

  const open = imports.filter((item) => item.status !== "approved").slice(0, 3);

  return (
    <Panel>
      <PanelHeader icon={FileUp} title="Read a publication" hint="Approve what it lists" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <SourceSelect value={sourceKey} onChange={setSourceKey} />
        <input className={inputClass} placeholder="Title, e.g. PPRA debarred firms, Oct 2026" value={title} onChange={(event) => setTitle(event.target.value)} />
        <input type="file" accept=".pdf,.txt,.html,.htm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="text-[11px]" />
        {domains.length ? (
          <input className={inputClass} placeholder={`…or one page on ${domains.join(" / ")}`} value={url} disabled={Boolean(file)} onChange={(event) => setUrl(event.target.value)} />
        ) : null}
        <button type="button" className={`${buttonClass} w-full`} disabled={busy || !title.trim() || (!file && !url.trim())} onClick={() => void submit()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Read names
        </button>
        <p className="text-[10px] text-sentinel-subtle">A page is fetched once, only from the authority&apos;s own site and only if its robots.txt allows it. Sentinel never crawls.</p>
        {open.map((item) => (
          <div key={item._id} className="rounded border border-sentinel-line p-2">
            <p className="font-medium">{item.label}</p>
            <p className="text-[10px] text-sentinel-subtle">
              {label(item.sourceKey)} · <ClientDate value={item.createdAt} format="PPp" />
            </p>
            {item.status === "reading" ? (
              <p className="text-sentinel-subtle">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Reading…
              </p>
            ) : item.status === "failed" ? (
              <p className="text-sentinel-red-text">{item.error}</p>
            ) : (
              <>
                <p className="text-sentinel-subtle">{item.proposals?.length ?? 0} names found. Tick the ones to add.</p>
                <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto">
                  {(item.proposals ?? []).map((proposal, index) => (
                    <li key={index}>
                      <label className="flex items-start gap-1.5">
                        <input
                          type="checkbox"
                          checked={selected[item._id]?.has(index) ?? false}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current[item._id] ?? []);
                              if (event.target.checked) next.add(index);
                              else next.delete(index);
                              return { ...current, [item._id]: next };
                            })
                          }
                        />
                        <span>
                          <span className="font-medium">{proposal.name}</span> <Badge tone="neutral">{proposal.entityType === "entity" ? "organisation" : "person"}</Badge>
                          <span className="block text-sentinel-subtle">
                            {proposal.reason}
                            {proposal.action ? ` · ${proposal.action}` : ""}
                            {proposal.reference ? ` · Ref. ${proposal.reference}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 flex gap-2">
                  <button type="button" className="text-sentinel-blue hover:underline" onClick={() => setSelected((current) => ({ ...current, [item._id]: new Set((item.proposals ?? []).map((_, index) => index)) }))}>
                    Tick all
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!selected[item._id]?.size}
                    onClick={() =>
                      void approve({ importId: item._id, indexes: [...(selected[item._id] ?? [])] }).then(
                        (result: { added: number }) => toast.success(`Added ${result.added}.`),
                        (error: unknown) => toast.error(getErrorMessage(error, "Couldn't approve.")),
                      )
                    }
                  >
                    Approve {selected[item._id]?.size ?? 0}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ImportPanel() {
  const importCsv = useMutation(anyApi.riskLists.importCsv);
  const [sourceKey, setSourceKey] = useState<RiskListKey>("KE_PPRA_DEBARRED");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel>
      <PanelHeader icon={Upload} title="Import CSV" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <SourceSelect value={sourceKey} onChange={setSourceKey} />
        <p className="text-sentinel-subtle">
          Columns: <span className="font-mono">name, entity_type, reason</span> (required; entity_type is individual or entity) and <span className="font-mono">action, start_date, end_date, reference, aliases</span>.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="text-[11px]" />
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={busy || !file}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            try {
              const result = (await importCsv({ sourceKey, csv: await file.text(), label: file.name })) as { added: number; errors: string[] };
              toast.success(`Imported ${result.added}${result.errors.length ? `; ${result.errors.length} lines skipped` : ""}.`);
              setFile(null);
            } catch (error) {
              toast.error(getErrorMessage(error, "Couldn't import the file."));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import
        </button>
      </div>
    </Panel>
  );
}

function AddPanel() {
  const add = useMutation(anyApi.riskLists.add);
  const empty = { sourceKey: "KE_PPRA_DEBARRED" as RiskListKey, name: "", entityType: "entity" as "individual" | "entity", reason: "", action: "", reference: "", endDate: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  return (
    <Panel>
      <PanelHeader icon={UserPlus} title="Add an entry" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <SourceSelect value={form.sourceKey} onChange={(sourceKey) => setForm({ ...form, sourceKey })} />
        <input className={inputClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <select className={inputClass} value={form.entityType} onChange={(event) => setForm({ ...form, entityType: event.target.value as "individual" | "entity" })}>
          <option value="entity">Organisation</option>
          <option value="individual">Person</option>
        </select>
        <input className={inputClass} placeholder="Why they are listed" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="Action, e.g. Debarred 3 years" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })} />
          <input className={inputClass} placeholder="Ends (YYYY-MM-DD)" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
        </div>
        <input className={inputClass} placeholder="Reference" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={busy || !form.name.trim() || !form.reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await add({
                sourceKey: form.sourceKey,
                entry: {
                  name: form.name,
                  entityType: form.entityType,
                  reason: form.reason,
                  ...(form.action ? { action: form.action } : {}),
                  ...(form.reference ? { reference: form.reference } : {}),
                  ...(form.endDate ? { endDate: form.endDate } : {}),
                },
              });
              toast.success("Added");
              setForm({ ...empty, sourceKey: form.sourceKey });
            } catch (error) {
              toast.error(getErrorMessage(error, "Couldn't add the entry."));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add
        </button>
      </div>
    </Panel>
  );
}
