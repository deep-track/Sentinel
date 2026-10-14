"use client";

import { useEffect, useMemo, useState } from "react";
import { anyApi } from "convex/server";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/modules/shared/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";

// Shared building blocks for the Settings pages.

export type Option = { value: string; label: string };

export type ResolvedSettings = {
  review: {
    fourEyes: string[];
    makerChecker: boolean;
    clearance: Record<string, string>;
    assignment: "manual" | "round_robin";
    deadlinesHours: { high: number; normal: number; low: number };
    requireReasonCode: boolean;
    approveReasons: string[];
    rejectReasons: string[];
  };
  screening: {
    matchThreshold: number;
    highRiskPepClasses: number[];
    monitoringDefault: boolean;
    monitoringFrequency: "daily" | "weekly" | "monthly";
    adverseMediaCategories: string[] | null;
    aiGeneratedAction: "reject" | "review";
    documentFraudAction: "reject" | "review";
    poaMaxAgeDays: number;
    acceptedPoaDocuments: string[] | null;
    rememberClearedMatches: boolean;
  };
  notifications: {
    events: Record<string, { enabled: boolean; email: boolean; roles: string[] }>;
    lowCreditBalance: number | null;
  };
  security: {
    requireMfa: boolean;
    sessionTimeoutMinutes: number;
    allowedEmailDomains: string[];
    ipAllowlist: string[];
    ipAllowlistApi: boolean;
  };
  data: { retentionMonths: number };
  profile: {
    legalName?: string;
    registrationNumber?: string;
    regulator?: string;
    regulatorOther?: string;
    licenceNumber?: string;
    address?: string;
    complianceContactName?: string;
    complianceContactEmail?: string;
    complianceContactPhone?: string;
    logoStorageId?: string;
  };
};

export type SettingsData = {
  role: string;
  canEdit: boolean;
  client: { name: string; plan: string; status: string; seatLimit: number | null; lowCreditDefault: number; creditBalance: number | null };
  settings: ResolvedSettings;
  logoUrl: string | null;
  options: {
    roles: Option[];
    decisionRoles: Option[];
    categories: Option[];
    queues: Option[];
    adverseMedia: Option[];
    poaDocuments: Option[];
    events: Array<Option & { detail: string; personal: boolean }>;
    regulators: Option[];
    limits: { minMatchThreshold: number; maxMatchThreshold: number; maxPoaAgeDays: number; minRetentionMonths: number; maxRetentionMonths: number };
  };
};

export function useSettings(clientId: string) {
  return useAuthedQuery(anyApi.orgSettings.get, { clientId }) as SettingsData | null | undefined;
}

export function SettingsLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function SettingsUnavailable() {
  return <Card className="p-6 border-dashed text-sm text-muted-foreground">Settings can&apos;t be loaded for this organization.</Card>;
}

export function ReadOnlyNotice({ canEdit }: { canEdit: boolean }) {
  if (canEdit) return null;
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
      Only your organization&apos;s Admin can change these settings.
    </p>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-6 bg-card border-border space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function Toggle({
  checked,
  onChange,
  label,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </label>
  );
}

export function CheckboxGroup({
  options,
  value,
  onChange,
  disabled,
  columns = 2,
}: {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  const selected = useMemo(() => new Set(value), [value]);
  const grid = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className={`grid grid-cols-1 gap-2 ${grid}`}>
      {options.map((option) => (
        <label key={option.value} className={`flex items-center gap-2 text-sm ${disabled ? "opacity-70" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            disabled={disabled}
            checked={selected.has(option.value)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(option.value);
              else next.delete(option.value);
              onChange(options.map((item) => item.value).filter((item) => next.has(item)));
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

// Edits one string per line.
export function LinesInput({ value, onChange, disabled, rows = 5, placeholder }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; rows?: number; placeholder?: string }) {
  return (
    <textarea
      className={`${inputClass} font-mono text-xs`}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      value={value.join("\n")}
      onChange={(event) => onChange(event.target.value.split("\n"))}
    />
  );
}

export function SaveBar({ dirty, saving, onSave, onReset, canEdit }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; canEdit: boolean }) {
  if (!canEdit) return null;
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
      <span className="mr-auto text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
      <Button type="button" variant="outline" disabled={!dirty || saving} onClick={onReset}>
        Discard
      </Button>
      <Button type="button" disabled={!dirty || saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save changes"
        )}
      </Button>
    </div>
  );
}

export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A local, editable copy of one settings section. It follows the saved
// value until the user starts editing, and again after a save or discard.
export function useDraft<T>(saved: T | undefined) {
  const savedKey = saved === undefined ? undefined : JSON.stringify(saved);
  const [draft, setDraft] = useState<T | undefined>(saved);
  const [baseKey, setBaseKey] = useState<string | undefined>(savedKey);
  useEffect(() => {
    if (savedKey === undefined) return;
    setDraft((current) => (baseKey === undefined || JSON.stringify(current) === baseKey ? (JSON.parse(savedKey) as T) : current));
    setBaseKey(savedKey);
    // Only react to new saved values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const dirty = draft !== undefined && savedKey !== undefined && JSON.stringify(draft) !== savedKey;
  const reset = () => {
    if (savedKey !== undefined) setDraft(JSON.parse(savedKey) as T);
  };
  return { draft, setDraft: setDraft as React.Dispatch<React.SetStateAction<T>>, dirty, reset };
}

// Runs a save with a toast for the outcome.
export function useSave() {
  const [saving, setSaving] = useState(false);
  async function run(action: () => Promise<unknown>, success = "Settings saved") {
    setSaving(true);
    try {
      await action();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "The settings couldn't be saved."));
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { saving, run };
}
