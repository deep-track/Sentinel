"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { FileUp, Landmark, Loader2, Upload, UserPlus } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Badge, Panel, PanelHeader, SentinelCanvas, TopBar } from "@/components/sentinel/ui";
import { PEP_LEVEL_LABELS, PEP_LEVELS, type PepLevel } from "@/backend/convex/lib/kenyaPep";

// Back Office: the Kenyan PEP register. Upload a Kenya Gazette issue and
// approve what it lists, import a CSV, or add people one by one.

type Entry = {
  _id: string;
  fullName: string;
  aliases: string[];
  position: string;
  organisation?: string;
  level: PepLevel;
  pepClass: number;
  county?: string;
  startDate?: string;
  endDate?: string;
  relatedTo?: string;
  source: "gazette" | "import" | "manual";
  sourceRef?: string;
  active: boolean;
};
type Proposal = { fullName: string; position: string; organisation: string | null; level: PepLevel; county: string | null; effectiveDate: string | null; endsAppointment: boolean; gazetteNotice: string | null };
type Data = {
  entries: Entry[];
  counts: { total: number; byLevel: Record<string, number> };
  imports: Array<{ _id: string; label: string; status: "reading" | "ready" | "failed" | "approved"; error: string | null; createdAt: number; proposals: Proposal[] | null; approvedCount: number | null }>;
};

const inputClass = "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text disabled:opacity-60";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded bg-sentinel-blue px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-60";

export function PepRegister({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState("");
  const data = useAuthedQuery(anyApi.pepRegister.list, { search: search || undefined }) as Data | undefined;
  const setActive = useMutation(anyApi.pepRegister.setActive);

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Kenyan PEP register</h1>
        <span className="text-[11px] text-sentinel-subtle">{data ? `${data.counts.total.toLocaleString("en-US")} active entries · screened in every AML check` : "Loading…"}</span>
      </TopBar>
      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {canWrite ? (
          <div className="grid gap-3.5 lg:grid-cols-3">
            <GazettePanel imports={data?.imports ?? []} />
            <ImportPanel />
            <AddPanel />
          </div>
        ) : null}
        <Panel>
          <PanelHeader
            icon={Landmark}
            title="Entries"
            hint={data ? PEP_LEVELS.filter((level) => data.counts.byLevel[level]).map((level) => `${PEP_LEVEL_LABELS[level]} ${data.counts.byLevel[level]}`).join(" · ") : undefined}
            action={<input className={`${inputClass} w-56`} placeholder="Search name, position, county" value={search} onChange={(event) => setSearch(event.target.value)} />}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-left text-sentinel-subtle">
                <tr>
                  <th className="px-3.5 py-2 font-medium">Name</th>
                  <th className="px-3.5 py-2 font-medium">Position</th>
                  <th className="px-3.5 py-2 font-medium">Level</th>
                  <th className="px-3.5 py-2 font-medium">Term</th>
                  <th className="px-3.5 py-2 font-medium">Source</th>
                  <th className="px-3.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).map((entry) => (
                  <tr key={entry._id} className="border-t border-sentinel-line align-top">
                    <td className="px-3.5 py-2">
                      <p className="font-medium">{entry.fullName}</p>
                      {entry.aliases.length ? <p className="text-sentinel-subtle">aka {entry.aliases.join(", ")}</p> : null}
                      {entry.relatedTo ? <p className="text-sentinel-subtle">{entry.relatedTo}</p> : null}
                    </td>
                    <td className="px-3.5 py-2">
                      {entry.position}
                      {entry.organisation ? <span className="text-sentinel-muted">, {entry.organisation}</span> : null}
                      {entry.county ? <span className="text-sentinel-muted"> · {entry.county}</span> : null}
                    </td>
                    <td className="px-3.5 py-2">
                      <Badge tone={entry.pepClass <= 2 ? "red" : "amber"}>Class {entry.pepClass}</Badge>
                      <span className="ml-1 text-sentinel-subtle">{PEP_LEVEL_LABELS[entry.level]}</span>
                    </td>
                    <td className="px-3.5 py-2 text-sentinel-muted">
                      {entry.startDate ?? "?"} – {entry.endDate ?? "current"}
                    </td>
                    <td className="px-3.5 py-2 text-sentinel-muted">
                      {entry.source}
                      {entry.sourceRef ? <span className="block text-sentinel-subtle">{entry.sourceRef}</span> : null}
                    </td>
                    <td className="px-3.5 py-2 text-right">
                      {canWrite ? (
                        <button
                          type="button"
                          className="text-sentinel-muted hover:underline"
                          onClick={() => {
                            if (!window.confirm(`Remove ${entry.fullName} from the register? Screening stops matching them.`)) return;
                            void setActive({ id: entry._id, active: false }).then(
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
            {data && data.entries.length === 0 ? <p className="p-3.5 text-[12px] text-sentinel-subtle">No entries yet. Upload a Kenya Gazette issue or import a CSV.</p> : null}
          </div>
        </Panel>
      </div>
    </SentinelCanvas>
  );
}

function GazettePanel({ imports }: { imports: Data["imports"] }) {
  const generateUploadUrl = useMutation(anyApi.pepRegister.generateUploadUrl);
  const readGazette = useMutation(anyApi.pepRegister.readGazette);
  const approve = useMutation(anyApi.pepRegister.approveGazette);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let storageId: string | undefined;
      let text: string | undefined;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const url = (await generateUploadUrl({})) as string;
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        if (!response.ok) throw new Error("Upload failed");
        storageId = ((await response.json()) as { storageId: string }).storageId;
      } else {
        text = await file.text();
      }
      await readGazette({ label, ...(storageId ? { storageId } : {}), ...(text ? { text } : {}) });
      toast.success("Reading the issue. Its appointments appear below for approval.");
      setFile(null);
      setLabel("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't read the issue."));
    } finally {
      setBusy(false);
    }
  };

  const ready = imports.filter((item) => item.status === "ready" || item.status === "reading" || item.status === "failed").slice(0, 3);

  return (
    <Panel>
      <PanelHeader icon={FileUp} title="Kenya Gazette" hint="Upload an issue; approve what it lists" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <input className={inputClass} placeholder="Issue, e.g. Vol. CXXVIII No. 181, 15 Oct 2026" value={label} onChange={(event) => setLabel(event.target.value)} />
        <input type="file" accept=".pdf,.txt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="text-[11px]" />
        <button type="button" className={`${buttonClass} w-full`} disabled={busy || !file || !label.trim()} onClick={() => void upload()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Read appointments
        </button>
        <p className="text-[10px] text-sentinel-subtle">Use issues from the Government Printer or under Kenya Law&apos;s terms. Sentinel never downloads the Gazette itself.</p>
        {ready.map((item) => (
          <div key={item._id} className="rounded border border-sentinel-line p-2">
            <p className="font-medium">{item.label}</p>
            {item.status === "reading" ? (
              <p className="text-sentinel-subtle">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Reading…
              </p>
            ) : item.status === "failed" ? (
              <p className="text-sentinel-red-text">{item.error}</p>
            ) : (
              <>
                <p className="text-sentinel-subtle">{item.proposals?.length ?? 0} appointments found. Tick the ones to add.</p>
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
                          <span className="font-medium">{proposal.fullName}</span> — {proposal.position}
                          {proposal.organisation ? `, ${proposal.organisation}` : ""}
                          {proposal.endsAppointment ? <Badge tone="neutral">ends</Badge> : null}
                          <span className="block text-sentinel-subtle">
                            {PEP_LEVEL_LABELS[proposal.level]}
                            {proposal.county ? ` · ${proposal.county}` : ""}
                            {proposal.effectiveDate ? ` · ${proposal.effectiveDate}` : ""}
                            {proposal.gazetteNotice ? ` · ${proposal.gazetteNotice}` : ""}
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
                        (result: { added: number; ended: number }) => toast.success(`Added ${result.added}, ended ${result.ended}.`),
                        (error: unknown) => toast.error(getErrorMessage(error, "Couldn't approve.")),
                      )
                    }
                  >
                    Approve {selected[item._id]?.size ?? 0}
                  </button>
                </div>
              </>
            )}
            <p className="text-[10px] text-sentinel-subtle">
              <ClientDate value={item.createdAt} format="PPp" />
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ImportPanel() {
  const importCsv = useMutation(anyApi.pepRegister.importCsv);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel>
      <PanelHeader icon={Upload} title="Import CSV" hint="County officials, boards, relatives" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <p className="text-sentinel-subtle">
          Columns: <span className="font-mono">full_name, position, level</span> (required) and <span className="font-mono">organisation, county, start_date, end_date, birth_date, aliases, related_to</span>. Levels:{" "}
          <span className="font-mono">{PEP_LEVELS.join(", ")}</span>.
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
              const result = (await importCsv({ csv: await file.text(), label: file.name })) as { added: number; errors: string[] };
              toast.success(`Imported ${result.added}${result.errors.length ? `; ${result.errors.length} lines skipped` : ""}.`);
              if (result.errors.length) console.warn(result.errors);
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
  const add = useMutation(anyApi.pepRegister.add);
  const empty = { fullName: "", position: "", organisation: "", level: "county_government" as PepLevel, county: "", startDate: "", relatedTo: "", aliases: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  return (
    <Panel>
      <PanelHeader icon={UserPlus} title="Add a person" />
      <div className="space-y-2 p-3.5 text-[12px]">
        <input className={inputClass} placeholder="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
        <input className={inputClass} placeholder="Position, e.g. Member of County Assembly" value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} />
        <input className={inputClass} placeholder="Organisation (optional)" value={form.organisation} onChange={(event) => setForm({ ...form, organisation: event.target.value })} />
        <select className={inputClass} value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value as PepLevel })}>
          {PEP_LEVELS.map((level) => (
            <option key={level} value={level}>
              {PEP_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="County" value={form.county} onChange={(event) => setForm({ ...form, county: event.target.value })} />
          <input className={inputClass} placeholder="Start (YYYY-MM-DD)" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
        </div>
        <input className={inputClass} placeholder="Also known as (; separated)" value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} />
        {form.level === "family_associate" ? <input className={inputClass} placeholder="Related to (e.g. spouse of Hon. X, Governor)" value={form.relatedTo} onChange={(event) => setForm({ ...form, relatedTo: event.target.value })} /> : null}
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={busy || !form.fullName.trim() || !form.position.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await add({
                entry: {
                  fullName: form.fullName,
                  position: form.position,
                  level: form.level,
                  ...(form.organisation ? { organisation: form.organisation } : {}),
                  ...(form.county ? { county: form.county } : {}),
                  ...(form.startDate ? { startDate: form.startDate } : {}),
                  ...(form.relatedTo ? { relatedTo: form.relatedTo } : {}),
                  aliases: form.aliases.split(";").map((alias) => alias.trim()).filter(Boolean),
                },
              });
              toast.success("Added to the register");
              setForm(empty);
            } catch (error) {
              toast.error(getErrorMessage(error, "Couldn't add the person."));
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
