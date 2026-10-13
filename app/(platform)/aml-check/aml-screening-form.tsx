"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  PEP_CLASS_LABELS,
  RISK_CATEGORIES,
  RISK_CATEGORY_LABELS,
  type PepClass,
  type RiskCategory,
} from "@/backend/convex/lib/amlCategories";

type EntityType = "individual" | "entity";

type CategorySummary = Partial<Record<RiskCategory, { hits: number; highestPepClass?: PepClass | null }>>;

type AmlRow = {
  _id: string;
  clientId: string;
  reference: string;
  status: "queued" | "processing" | "completed" | "failed";
  verdict?: "pass" | "review" | "reject" | null;
  failureReason?: string | null;
  input?: { subjectName?: string; entityType?: EntityType; country?: string | null } | null;
  result?: { reason?: string; categories?: CategorySummary } | null;
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

function categoryChips(summary: CategorySummary | undefined) {
  if (!summary) return [];
  return RISK_CATEGORIES.filter((category) => (summary[category]?.hits ?? 0) > 0).map((category) => {
    const pepClass = category === "pep" ? summary.pep?.highestPepClass : null;
    return {
      category,
      label: pepClass ? `PEP Class ${pepClass}` : RISK_CATEGORY_LABELS[category],
      title: pepClass ? PEP_CLASS_LABELS[pepClass] : `${summary[category]?.hits} hit(s)`,
    };
  });
}

const inputClass = "mt-2 w-full rounded-lg border p-2.5";

export function AMLScreeningForm({ clientId, canSubmit }: { clientId: string; canSubmit: boolean }) {
  const submit = useMutation(anyApi.aml.submit);
  const result = useAuthedQuery(anyApi.verifications.list, { type: "aml", limit: 50 }) as ListResult | undefined;
  // verifications.list spans every organization the user can access; show
  // only the one selected in the sidebar.
  const rows = result?.records.filter((row) => row.clientId === clientId);

  const [subjectName, setSubjectName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("individual");
  const [country, setCountry] = useState("");
  const [aliases, setAliases] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nationality, setNationality] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const individual = entityType === "individual";

  async function screen(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = subjectName.trim();
    if (!name) {
      setMessage({ tone: "error", text: "Enter a person or company name." });
      return;
    }
    const optional = (value: string) => value.trim() || undefined;
    const aliasList = aliases
      .split(/[,;\n]/)
      .map((alias) => alias.trim())
      .filter(Boolean);
    setPending(true);
    setMessage(null);
    try {
      await submit({
        clientId,
        subjectName: name,
        entityType,
        country: optional(country),
        aliases: aliasList.length ? aliasList : undefined,
        ...(individual
          ? { dateOfBirth: optional(dateOfBirth), nationality: optional(nationality), idNumber: optional(idNumber) }
          : { registrationNumber: optional(registrationNumber), jurisdiction: optional(jurisdiction) }),
      });
      setSubjectName("");
      setAliases("");
      setDateOfBirth("");
      setNationality("");
      setIdNumber("");
      setRegistrationNumber("");
      setJurisdiction("");
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
                className={inputClass}
                placeholder="Person or company"
                maxLength={200}
              />
            </label>
            <label className="text-sm font-medium">
              Entity type
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as EntityType)}
                className="mt-2 block w-full rounded-lg border p-2.5"
              >
                <option value="individual">Individual</option>
                <option value="entity">Company</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Country
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={inputClass}
                placeholder="Optional"
                maxLength={100}
              />
            </label>
            <label className="text-sm font-medium">
              Also known as
              <input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className={inputClass}
                placeholder="Optional, separate names with commas"
                maxLength={1000}
              />
            </label>
            {individual ? (
              <>
                <label className="text-sm font-medium">
                  Date of birth
                  <input
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className={inputClass}
                    placeholder="Optional: YYYY-MM-DD or YYYY"
                    maxLength={10}
                  />
                </label>
                <label className="text-sm font-medium">
                  Nationality
                  <input
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className={inputClass}
                    placeholder="Optional"
                    maxLength={100}
                  />
                </label>
                <label className="text-sm font-medium">
                  National ID or passport number
                  <input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    className={inputClass}
                    placeholder="Optional"
                    maxLength={100}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-sm font-medium">
                  Registration number
                  <input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    className={inputClass}
                    placeholder="Optional"
                    maxLength={100}
                  />
                </label>
                <label className="text-sm font-medium">
                  Country of incorporation
                  <input
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className={inputClass}
                    placeholder="Optional"
                    maxLength={100}
                  />
                </label>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Screens sanctions and watchlists, politically exposed persons (Class 1–4), special interest persons and
            entities, and fitness and probity lists. A date of birth or ID number reduces false matches.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {pending ? "Queueing…" : "Run AML screening"}
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
              const chips = categoryChips(row.result?.categories);
              return (
                <div key={row._id} className="flex items-center justify-between gap-4 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.input?.subjectName ?? row.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      <ClientDate value={row.createdAt} format="PPp" />
                      {row.status === "failed" && row.failureReason ? ` · ${row.failureReason}` : null}
                    </p>
                    {chips.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span
                            key={chip.category}
                            title={chip.title}
                            className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
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
