"use client";

import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
  CheckboxGroup,
  Field,
  LinesInput,
  ReadOnlyNotice,
  SaveBar,
  Section,
  SettingsLoading,
  SettingsUnavailable,
  Toggle,
  inputClass,
  useDraft,
  useSave,
  useSettings,
  type ResolvedSettings,
} from "@/components/settings/kit";

type Review = ResolvedSettings["review"];

export function ReviewSettings({ clientId }: { clientId: string }) {
  const data = useSettings(clientId);
  const { draft, setDraft, dirty, reset } = useDraft<Review>(data?.settings.review);
  const save = useMutation(anyApi.orgSettings.saveReview);
  const { saving, run } = useSave();

  if (data === undefined || (data && !draft)) return <SettingsLoading />;
  if (data === null || !draft) return <SettingsUnavailable />;
  const { options, canEdit } = data;
  const set = (patch: Partial<Review>) => setDraft((current) => ({ ...current, ...patch }));
  const disabled = !canEdit;

  return (
    <>
      <ReadOnlyNotice canEdit={canEdit} />

      <Section title="Who can decide what" description="The lowest role that may make the final decision on each kind of case. Anyone below it can still investigate and recommend.">
        <div className="divide-y rounded-lg border">
          {options.categories.map((category) => (
            <div key={category.value} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_220px]">
              <span className="text-sm font-medium">{category.label}</span>
              <select
                aria-label={`Who can clear ${category.label}`}
                className={inputClass}
                disabled={disabled}
                value={draft.clearance[category.value]}
                onChange={(event) => set({ clearance: { ...draft.clearance, [category.value]: event.target.value } })}
              >
                {options.decisionRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label} or above
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Four-eyes approval" description="Cases in these categories always need two people: one recommends, a second person with clearance approves.">
        <CheckboxGroup options={options.categories} value={draft.fourEyes} onChange={(fourEyes) => set({ fourEyes })} disabled={disabled} />
        <Toggle
          checked={draft.makerChecker}
          onChange={(makerChecker) => set({ makerChecker })}
          disabled={disabled}
          label="Maker-checker"
          detail="The person who ran a check can't make the final decision on it; their decision becomes a recommendation."
        />
      </Section>

      <Section title="Assignment" description="How new cases reach your team.">
        <div className="space-y-2">
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="assignment" className="mt-0.5 accent-primary" disabled={disabled} checked={draft.assignment === "manual"} onChange={() => set({ assignment: "manual" })} />
            <span>
              <span className="font-medium">Manual</span>
              <span className="block text-xs text-muted-foreground">Cases wait in the unassigned queue; people take them, or a Reviewer or Admin assigns them.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="assignment" className="mt-0.5 accent-primary" disabled={disabled} checked={draft.assignment === "round_robin"} onChange={() => set({ assignment: "round_robin" })} />
            <span>
              <span className="font-medium">Automatic (share evenly)</span>
              <span className="block text-xs text-muted-foreground">Each new case goes to the Analyst, Reviewer or Admin with the fewest open cases in that queue. Choose people&apos;s queues on the Team page.</span>
            </span>
          </label>
        </div>
      </Section>

      <Section title="Review deadlines" description="Hours from when a case opens to the final decision. Cases past their deadline become high priority and the team is alerted (Notifications → Missed review deadline).">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["high", "normal", "low"] as const).map((priority) => (
            <Field key={priority} label={`${priority[0].toUpperCase()}${priority.slice(1)} priority`} htmlFor={`deadline-${priority}`}>
              <input
                id={`deadline-${priority}`}
                type="number"
                min={1}
                max={720}
                className={inputClass}
                disabled={disabled}
                value={draft.deadlinesHours[priority]}
                onChange={(event) => set({ deadlinesHours: { ...draft.deadlinesHours, [priority]: Number(event.target.value) } })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Reason codes" description="The reasons people pick when they approve or reject a case. They appear in the audit log and reports.">
        <Toggle checked={draft.requireReasonCode} onChange={(requireReasonCode) => set({ requireReasonCode })} disabled={disabled} label="Require a reason for every decision" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Approve reasons" hint="One per line.">
            <LinesInput value={draft.approveReasons} onChange={(approveReasons) => set({ approveReasons })} disabled={disabled} rows={7} />
          </Field>
          <Field label="Reject reasons" hint="One per line.">
            <LinesInput value={draft.rejectReasons} onChange={(rejectReasons) => set({ rejectReasons })} disabled={disabled} rows={7} />
          </Field>
        </div>
      </Section>

      <SaveBar
        canEdit={canEdit}
        dirty={dirty}
        saving={saving}
        onReset={reset}
        onSave={() =>
          void run(() =>
            save({
              clientId,
              review: {
                ...draft,
                approveReasons: draft.approveReasons.map((line) => line.trim()).filter(Boolean),
                rejectReasons: draft.rejectReasons.map((line) => line.trim()).filter(Boolean),
              },
            }),
          )
        }
      />
    </>
  );
}
