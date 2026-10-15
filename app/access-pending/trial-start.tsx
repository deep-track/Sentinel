"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countries } from "@/backend/lib/kyb-types";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// Signed in without a workspace: start a free trial (signups.startTrial).

type Status = { canStart: boolean; reason: string | null; email: string; prefill: { name: string; company: string; country: string } | null; trialDays: number } | null;

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function TrialStart() {
  const status = useAuthedQuery(anyApi.signups.myTrialStatus, {}) as Status | undefined;
  const startTrial = useMutation(anyApi.signups.startTrial);
  const [form, setForm] = useState({ company: "", country: "KE", phone: "", acceptTerms: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status?.prefill) setForm((current) => ({ ...current, company: current.company || status.prefill!.company, country: status.prefill!.country }));
  }, [status?.prefill]);

  if (!status) return null;
  if (!status.canStart) {
    return status.reason ? <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{status.reason}</p> : null;
  }

  return (
    <form
      className="mt-6 space-y-4 rounded-xl border border-violet-200 bg-violet-50/50 p-5 dark:border-violet-900 dark:bg-violet-950/20"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await startTrial({ company: form.company, country: form.country, phone: form.phone || undefined, acceptTerms: form.acceptTerms });
          window.location.assign("/dashboard");
        } catch (caught) {
          setError(getErrorMessage(caught, "The trial couldn't be started."));
          setSaving(false);
        }
      }}
    >
      <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <Rocket className="h-5 w-5 text-violet-600" /> Start your free {status.trialDays}-day trial
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">You become the Admin of a new Sentinel workspace with free credits, and can invite your team.</p>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Organization</span>
        <input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} className={inputClass} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Country</span>
          <select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} className={inputClass}>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Phone (optional)</span>
          <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} placeholder="+254…" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="mt-1" checked={form.acceptTerms} onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })} />
        <span>
          I accept DeepTrack&apos;s{" "}
          <a href="https://deeptrack.io/terms" target="_blank" rel="noreferrer" className="underline">
            terms of service
          </a>{" "}
          and{" "}
          <a href="https://deeptrack.io/privacy" target="_blank" rel="noreferrer" className="underline">
            privacy policy
          </a>
          , and I&apos;m authorized to act for this organization.
        </span>
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" disabled={saving || !form.acceptTerms || form.company.trim().length < 2}>
        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Start free trial
      </Button>
    </form>
  );
}
