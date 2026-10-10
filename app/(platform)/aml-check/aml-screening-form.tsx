"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

type EntityType = "individual" | "entity";

type AmlRow = {
  _id: string;
  clientId: string;
  reference: string;
  status: "queued" | "processing" | "completed" | "failed";
  verdict?: "pass" | "review" | "reject" | null;
  failureReason?: string | null;
  input?: { subjectName?: string; entityType?: EntityType; country?: string | null } | null;
  createdAt: number;
};

type ListResult = { records: AmlRow[]; nextCursor: number | null };

function outcomeLabel(row: AmlRow): { label: string; className: string } {
  if (row.status === "failed") return { label: "Failed", className: "text-red-600 dark:text-red-400" };
  if (row.verdict === "pass") return { label: "Clear", className: "text-emerald-600 dark:text-emerald-400" };
  if (row.verdict === "reject") return { label: "Match", className: "text-red-600 dark:text-red-400" };
  if (row.verdict === "review") return { label: "Needs review", className: "text-amber-600 dark:text-amber-400" };
  if (row.status === "processing") return { label: "Screening…", className: "text-muted-foreground" };
  return { label: "Queued", className: "text-muted-foreground" };
}

export function AMLScreeningForm({ clientId, canSubmit }: { clientId: string; canSubmit: boolean }) {
  const submit = useMutation(anyApi.aml.submit);
  const result = useAuthedQuery(anyApi.verifications.list, { type: "aml", limit: 50 }) as ListResult | undefined;
  // verifications.list spans every organization the user can access; show
  // only the one selected in the sidebar.
  const rows = result?.records.filter((row) => row.clientId === clientId);

  const [subjectName, setSubjectName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("individual");
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function screen(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = subjectName.trim();
    if (!name) {
      setMessage({ tone: "error", text: "Enter a person or company name." });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await submit({ clientId, subjectName: name, entityType, country: country.trim() || undefined });
      setSubjectName("");
      setMessage({ tone: "info", text: "Screening queued. Results will update automatically." });
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "Screening could not be queued.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {canSubmit ? (
        <form onSubmit={screen} className="rounded-xl border bg-card p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Subject name
              <input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className="mt-2 w-full rounded-lg border p-2.5"
                placeholder="Person or company"
                maxLength={200}
              />
            </label>
            <label className="text-sm font-medium">
              Country
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-2 w-full rounded-lg border p-2.5"
                placeholder="Optional"
                maxLength={100}
              />
            </label>
          </div>
          <label className="text-sm font-medium">
            Entity type
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              className="mt-2 block rounded-lg border p-2.5"
            >
              <option value="individual">Individual</option>
              <option value="entity">Company</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {pending ? "Queueing…" : "Run sanctions screening"}
          </button>
          {message ? (
            <p className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {message.text}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Your role can view screenings but not run new ones.
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-medium">Recent screenings</div>
        <div className="divide-y">
          {rows === undefined ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No AML screenings yet.</p>
          ) : (
            rows.map((row) => {
              const outcome = outcomeLabel(row);
              return (
                <div key={row._id} className="flex items-center justify-between gap-4 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.input?.subjectName ?? row.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      <ClientDate value={row.createdAt} format="PPp" />
                      {row.status === "failed" && row.failureReason ? ` · ${row.failureReason}` : null}
                    </p>
                  </div>
                  <span className={`shrink-0 font-medium ${outcome.className}`}>{outcome.label}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
