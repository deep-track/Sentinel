"use client";

import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
  CheckboxGroup,
  Field,
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
import { ClearedMatches } from "./cleared-matches";

type Screening = ResolvedSettings["screening"];

// Same tiers as backend/convex/lib/amlCategories.ts PEP_CLASS_LABELS.
const PEP_CLASSES = [
  { value: "1", label: "Class 1: national / head of state level" },
  { value: "2", label: "Class 2: regional, diplomatic or senior military" },
  { value: "3", label: "Class 3: state-owned enterprise, international organisation, party or local government" },
  { value: "4", label: "Class 4: family member or close associate" },
];

export function ScreeningSettings({ clientId }: { clientId: string }) {
  const data = useSettings(clientId);
  const { draft, setDraft, dirty, reset } = useDraft<Screening>(data?.settings.screening);
  const save = useMutation(anyApi.orgSettings.saveScreening);
  const { saving, run } = useSave();

  if (data === undefined || (data && !draft)) return <SettingsLoading />;
  if (data === null || !draft) return <SettingsUnavailable />;
  const { options, canEdit } = data;
  const { limits } = options;
  const set = (patch: Partial<Screening>) => setDraft((current) => ({ ...current, ...patch }));
  const disabled = !canEdit;
  const allMedia = draft.adverseMediaCategories === null;
  const allPoa = draft.acceptedPoaDocuments === null;

  return (
    <>
      <ReadOnlyNotice canEdit={canEdit} />

      <Section title="AML matching" description="Applies to sanctions, PEP and watchlist screening, including ongoing monitoring.">
        <Field
          label={`Match threshold: ${draft.matchThreshold}%`}
          htmlFor="match-threshold"
          hint={`Hits scoring below this don't count. ${limits.minMatchThreshold}% is Sentinel's standard; raising it cuts false positives but can miss spelling variants and transliterations.`}
        >
          <input
            id="match-threshold"
            type="range"
            min={limits.minMatchThreshold}
            max={limits.maxMatchThreshold}
            step={1}
            className="w-full accent-primary"
            disabled={disabled}
            value={draft.matchThreshold}
            onChange={(event) => set({ matchThreshold: Number(event.target.value) })}
          />
        </Field>
        <Field label="High-risk PEP classes" hint="PEP hits in these classes are high priority and follow your PEP clearance and four-eyes rules.">
          <CheckboxGroup
            options={PEP_CLASSES}
            value={draft.highRiskPepClasses.map(String)}
            onChange={(value) => set({ highRiskPepClasses: value.map(Number) })}
            disabled={disabled}
            columns={1}
          />
        </Field>
      </Section>

      <Section
        title="False-positive memory"
        description="When a reviewer approves an AML case, its hits are remembered as cleared for that customer. Later screenings and monitoring don't raise them again, unless the hit becomes more severe (a new risk category, a more senior PEP class, or critical)."
      >
        <Toggle
          checked={draft.rememberClearedMatches}
          onChange={(rememberClearedMatches) => set({ rememberClearedMatches })}
          disabled={disabled}
          label="Don't raise cleared hits again"
          detail="Only for customers identified by more than a name: a customer reference, ID or registration number, or date of birth. A hit cleared for one person is never hidden for another with the same name."
        />
        <ClearedMatches clientId={clientId} />
      </Section>

      <Section
        title="AI hit review"
        description="Sentinel's AI compares the customer with each AML hit (date of birth, nationality, ID number, positions, the news story) and recommends clearing the hits, confirming the match or escalating, with its reasons. It only recommends: your reviewers decide, under your four-eyes and clearance rules."
      >
        <Toggle
          checked={draft.aiHitReview}
          onChange={(aiHitReview) => set({ aiHitReview })}
          disabled={disabled}
          label="Review hits with AI when a case opens"
          detail="ID numbers are compared by Sentinel itself and never sent to the AI. Reviewers can also run it on demand."
        />
      </Section>

      <Section
        title="Fraud network"
        description="Sentinel fingerprints the ID numbers, document numbers, phone numbers and emails in your checks, and flags one that turns up with a different name or date of birth, or in a check rejected for fraud. A strong signal sends a pass to review; it never rejects on its own. Only keyed fingerprints are kept: never the numbers, names or dates themselves."
      >
        <Toggle
          checked={draft.shareFraudNetwork}
          onChange={(shareFraudNetwork) => set({ shareFraudNetwork })}
          disabled={disabled}
          label="Join the Sentinel network"
          detail="Off: only your own checks are compared. On: your checks are also compared with those of other organizations that joined, and theirs with yours. Nobody is told which organization saw an identifier, or anything about the customer."
        />
      </Section>

      <Section
        title="Customer risk rating and periodic review"
        description="Every screened customer is rated low, medium or high risk from their geography (FATF lists), PEP status, hits still standing, type and industry. Monitored customers come up for review on this schedule; high-risk ones need enhanced due diligence."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {(["high", "medium", "low"] as const).map((level) => (
            <Field key={level} label={`${level.charAt(0).toUpperCase()}${level.slice(1)} risk: review every (months)`} htmlFor={`review-${level}`}>
              <input
                id={`review-${level}`}
                type="number"
                min={1}
                max={level === "low" ? 120 : 60}
                className={inputClass}
                disabled={disabled}
                value={draft.reviewMonths[level]}
                onChange={(event) => set({ reviewMonths: { ...draft.reviewMonths, [level]: Number(event.target.value) } })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Ongoing monitoring">
        <Toggle
          checked={draft.monitoringDefault}
          onChange={(monitoringDefault) => set({ monitoringDefault })}
          disabled={disabled}
          label="Monitor every new AML screening by default"
          detail="Applies when a screening (portal or API) doesn't say whether to monitor. Monitoring is included in the screening price."
        />
        <Field label="Re-screen frequency" htmlFor="monitoring-frequency" hint="Applies to subjects as they are next re-screened.">
          <select
            id="monitoring-frequency"
            className={`${inputClass} sm:w-60`}
            disabled={disabled}
            value={draft.monitoringFrequency}
            onChange={(event) => set({ monitoringFrequency: event.target.value as Screening["monitoringFrequency"] })}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
      </Section>

      <Section title="Adverse media" description="Which kinds of negative news count as a hit.">
        <Toggle
          checked={allMedia}
          onChange={(all) => set({ adverseMediaCategories: all ? null : options.adverseMedia.map((option) => option.value) })}
          disabled={disabled}
          label="Screen for every category"
        />
        {!allMedia ? (
          <CheckboxGroup options={options.adverseMedia} value={draft.adverseMediaCategories ?? []} onChange={(value) => set({ adverseMediaCategories: value })} disabled={disabled} columns={3} />
        ) : null}
      </Section>

      <Section title="Documents (IDP)" description="What happens when a document fails Sentinel's fraud checks.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="AI-generated document" htmlFor="ai-action" hint="Generator metadata, content credentials or visual signs of AI generation.">
            <select id="ai-action" className={inputClass} disabled={disabled} value={draft.aiGeneratedAction} onChange={(event) => set({ aiGeneratedAction: event.target.value as Screening["aiGeneratedAction"] })}>
              <option value="reject">Reject automatically</option>
              <option value="review">Send to review</option>
            </select>
          </Field>
          <Field label="Other document fraud" htmlFor="fraud-action" hint="Expired, altered or impossible documents and failed MRZ checks.">
            <select id="fraud-action" className={inputClass} disabled={disabled} value={draft.documentFraudAction} onChange={(event) => set({ documentFraudAction: event.target.value as Screening["documentFraudAction"] })}>
              <option value="reject">Reject automatically</option>
              <option value="review">Send to review</option>
            </select>
          </Field>
        </div>
        <Field label="Proof of address maximum age (days)" htmlFor="poa-age" hint="Used when a request doesn't set its own limit. 90 days is the usual standard.">
          <input
            id="poa-age"
            type="number"
            min={1}
            max={limits.maxPoaAgeDays}
            className={`${inputClass} sm:w-40`}
            disabled={disabled}
            value={draft.poaMaxAgeDays}
            onChange={(event) => set({ poaMaxAgeDays: Number(event.target.value) })}
          />
        </Field>
        <Field label="Accepted proof of address documents" hint="A document of another type can't pass and goes to review.">
          <Toggle
            checked={allPoa}
            onChange={(all) => set({ acceptedPoaDocuments: all ? null : options.poaDocuments.map((option) => option.value) })}
            disabled={disabled}
            label="Accept every recognised type"
          />
          {!allPoa ? (
            <div className="pt-2">
              <CheckboxGroup options={options.poaDocuments} value={draft.acceptedPoaDocuments ?? []} onChange={(value) => set({ acceptedPoaDocuments: value })} disabled={disabled} columns={3} />
            </div>
          ) : null}
        </Field>
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
              screening: {
                matchThreshold: draft.matchThreshold,
                highRiskPepClasses: draft.highRiskPepClasses,
                monitoringDefault: draft.monitoringDefault,
                monitoringFrequency: draft.monitoringFrequency,
                aiGeneratedAction: draft.aiGeneratedAction,
                documentFraudAction: draft.documentFraudAction,
                poaMaxAgeDays: draft.poaMaxAgeDays,
                rememberClearedMatches: draft.rememberClearedMatches,
                aiHitReview: draft.aiHitReview,
                shareFraudNetwork: draft.shareFraudNetwork,
                reviewMonths: draft.reviewMonths,
                // null (every category) is stored as "not set".
                ...(draft.adverseMediaCategories ? { adverseMediaCategories: draft.adverseMediaCategories } : {}),
                ...(draft.acceptedPoaDocuments ? { acceptedPoaDocuments: draft.acceptedPoaDocuments } : {}),
              },
            }),
          )
        }
      />
    </>
  );
}
