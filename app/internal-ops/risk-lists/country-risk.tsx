"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Globe2 } from "lucide-react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Panel, PanelHeader } from "@/components/sentinel/ui";

// FATF lists used by customer risk ratings (riskRatings.ts). Update after
// each FATF plenary (February, June, October): fatf-gafi.org.

type Settings = { callForAction: string[]; increasedMonitoring: string[]; asOf: string; updatedAt: number | null };
const inputClass = "w-full rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 font-mono text-[12px] text-sentinel-text disabled:opacity-60";

export function CountryRisk({ canWrite }: { canWrite: boolean }) {
  const data = useAuthedQuery(anyApi.riskRatings.countryRisk, {}) as Settings | undefined;
  const save = useMutation(anyApi.riskRatings.saveCountryRisk);
  const [form, setForm] = useState({ callForAction: "", increasedMonitoring: "", asOf: "" });
  useEffect(() => {
    if (data) setForm({ callForAction: data.callForAction.join(", "), increasedMonitoring: data.increasedMonitoring.join(", "), asOf: data.asOf });
  }, [data]);
  const split = (value: string) => value.split(/[\s,;]+/).filter(Boolean);
  const stale = data ? Date.now() - Date.parse(`${data.asOf}T00:00:00Z`) > 140 * 24 * 3600_000 : false;

  return (
    <Panel>
      <PanelHeader icon={Globe2} title="Country risk (FATF)" hint={data ? `Lists as of ${data.asOf}${stale ? " — check for a newer FATF statement" : ""}` : "Loading…"} />
      <div className="grid gap-2 p-3.5 text-[12px] lg:grid-cols-[1fr_2fr_auto]">
        <label className="block">
          <span className="text-sentinel-subtle">Call for action (black list)</span>
          <input className={inputClass} disabled={!canWrite} value={form.callForAction} onChange={(event) => setForm({ ...form, callForAction: event.target.value })} />
        </label>
        <label className="block">
          <span className="text-sentinel-subtle">Increased monitoring (grey list)</span>
          <input className={inputClass} disabled={!canWrite} value={form.increasedMonitoring} onChange={(event) => setForm({ ...form, increasedMonitoring: event.target.value })} />
        </label>
        <label className="block">
          <span className="text-sentinel-subtle">FATF statement date</span>
          <input className={inputClass} disabled={!canWrite} placeholder="2026-10-30" value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })} />
        </label>
        <p className="text-[10px] text-sentinel-subtle lg:col-span-2">
          Two-letter ISO codes. A client&apos;s own country isn&apos;t scored for its own customers (Kenya is on the grey list, so Kenyan banks&apos; Kenyan customers aren&apos;t marked up for it).
        </p>
        {canWrite ? (
          <button
            type="button"
            className="rounded bg-sentinel-blue px-2.5 py-1.5 text-[12px] font-medium text-white"
            onClick={() =>
              void save({ callForAction: split(form.callForAction), increasedMonitoring: split(form.increasedMonitoring), asOf: form.asOf.trim() }).then(
                () => toast.success("FATF lists saved. New ratings use them."),
                (error: unknown) => toast.error(getErrorMessage(error, "Couldn't save the lists.")),
              )
            }
          >
            Save
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
