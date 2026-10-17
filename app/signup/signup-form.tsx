"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countries } from "@/backend/lib/kyb-types";
import { requestSignup, type SignupResult } from "./actions";

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function SignupForm() {
  const [form, setForm] = useState({ name: "", email: "", company: "", country: "KE", website: "" });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SignupResult | null>(null);

  if (result?.ok) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <MailCheck className="h-5 w-5" /> {result.emailSent ? "Check your inbox" : "Almost there"}
        </p>
        {result.emailSent ? (
          <p className="text-slate-600 dark:text-slate-300">
            We sent an invitation to <span className="font-medium">{result.email}</span>. Open it, set your password, and your trial starts straight away.
          </p>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">
            Sign in with <span className="font-medium">{result.email}</span> to start your trial.{" "}
            <a href="/auth/login" className="underline">
              Sign in
            </a>
          </p>
        )}
        {result.existingTrial ? (
          <p className="text-amber-700 dark:text-amber-400">Someone at your organization already started a trial. Ask them to invite you from Settings → Team.</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setResult(await requestSignup(form));
        setSaving(false);
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Full name</span>
        <input required autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Work email</span>
        <input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} placeholder="you@yourbank.co.ke" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Organization</span>
        <input required autoComplete="organization" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} className={inputClass} />
      </label>
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
      {/* Honeypot: hidden from people, filled in by bots. */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} name="website" />
      {result && !result.ok ? <p className="text-sm text-red-600">{result.error}</p> : null}
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Start free trial
      </Button>
      <p className="text-xs text-slate-500">Work email required. Prices in KES for Kenyan organizations, USD elsewhere.</p>
    </form>
  );
}
