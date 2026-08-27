"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";

export function AMLScreeningForm({ clientId }: { clientId: string }) {
  const submit = useMutation(anyApi.aml.submit);
  const rows = useQuery(anyApi.verifications.list, clientId ? { type: "aml", limit: 25 } : "skip");
  const [subjectName, setSubjectName] = useState("");
  const [entityType, setEntityType] = useState<"individual" | "entity">("individual");
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function screen() {
    if (!subjectName.trim()) return setMessage("Enter a person or company name.");
    setPending(true); setMessage(null);
    try {
      await submit({ clientId: clientId as any, subjectName, entityType, country: country || undefined });
      setSubjectName(""); setMessage("Screening queued. Results will update automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Screening could not be queued.");
    } finally { setPending(false); }
  }
  return <div className="space-y-6"><div className="rounded-xl border bg-card p-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Subject name<input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className="mt-2 w-full rounded-lg border p-2.5" placeholder="Person or company" /></label><label className="text-sm font-medium">Country<input value={country} onChange={(e) => setCountry(e.target.value)} className="mt-2 w-full rounded-lg border p-2.5" placeholder="Optional" /></label></div><label className="text-sm font-medium">Entity type<select value={entityType} onChange={(e) => setEntityType(e.target.value as "individual" | "entity")} className="mt-2 block rounded-lg border p-2.5"><option value="individual">Individual</option><option value="entity">Company</option></select></label><button onClick={screen} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Queueing…" : "Run sanctions screening"}</button>{message ? <p className="text-sm text-muted-foreground">{message}</p> : null}</div><div className="rounded-xl border bg-card overflow-hidden"><div className="border-b p-4 font-medium">Recent screenings</div><div className="divide-y">{(rows ?? []).map((row: any) => <div key={row._id} className="flex items-center justify-between gap-4 p-4 text-sm"><span className="font-medium">{row.input?.subjectName ?? row.reference}</span><span className="capitalize text-muted-foreground">{row.verdict ?? row.status}</span></div>)}{rows?.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No AML screenings yet.</p> : null}</div></div></div>;
}
