"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";

export function KYCReviewActions({ id }: { id: string }) {
  const review = useMutation(anyApi.verifications.review);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(verdict: "pass" | "review" | "reject") {
    setPending(true);
    setMessage(null);
    try {
      await review({ id: id as any, verdict, notes: notes.trim() || undefined });
      setMessage("Decision saved successfully.");
    } catch (error) {
      console.error("[kyc.review] mutation failed", error);
      setMessage("The decision could not be saved. Confirm that your Sentinel reviewer role is active.");
    } finally {
      setPending(false);
    }
  }

  return <div className="space-y-4"><label className="block"><span className="text-sm font-medium text-slate-700 dark:text-slate-300">Review notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Record the reason for this decision" /></label><div className="flex flex-wrap gap-3"><button disabled={pending} onClick={() => submit("pass")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button><button disabled={pending} onClick={() => submit("review")} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Keep in review</button><button disabled={pending} onClick={() => submit("reject")} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Decline</button></div>{message ? <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}</div>;
}
