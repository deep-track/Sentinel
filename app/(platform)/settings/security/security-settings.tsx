"use client";

import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
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

type Security = ResolvedSettings["security"];

const TIMEOUTS = [
  { value: 0, label: "Off" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
];

export function SecuritySettings({ clientId, currentIp }: { clientId: string; currentIp: string | null }) {
  const data = useSettings(clientId);
  const { draft, setDraft, dirty, reset } = useDraft<Security>(data?.settings.security);
  const save = useMutation(anyApi.orgSettings.saveSecurity);
  const { saving, run } = useSave();

  if (data === undefined || (data && !draft)) return <SettingsLoading />;
  if (data === null || !draft) return <SettingsUnavailable />;
  const { canEdit } = data;
  const disabled = !canEdit;
  const set = (patch: Partial<Security>) => setDraft((current) => ({ ...current, ...patch }));
  const timeouts = TIMEOUTS.some((option) => option.value === draft.sessionTimeoutMinutes)
    ? TIMEOUTS
    : [...TIMEOUTS, { value: draft.sessionTimeoutMinutes, label: `${draft.sessionTimeoutMinutes} minutes` }];

  return (
    <>
      <ReadOnlyNotice canEdit={canEdit} />

      <Section title="Sign-in">
        <Toggle
          checked={draft.requireMfa}
          onChange={(requireMfa) => set({ requireMfa })}
          disabled={disabled}
          label="Require two-step verification (MFA) for all members"
          detail="Members who signed in without a second step are asked to sign in again with one before they can use Sentinel. DeepTrack staff follow DeepTrack's own policy."
        />
        <Field label="Sign out after inactivity" htmlFor="idle-timeout" hint="Members are signed out after this long without using Sentinel in any tab.">
          <select id="idle-timeout" className={`${inputClass} sm:w-60`} disabled={disabled} value={draft.sessionTimeoutMinutes} onChange={(event) => set({ sessionTimeoutMinutes: Number(event.target.value) })}>
            {timeouts.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Allowed email domains" description="Only addresses at these domains can be invited to your team (subdomains included). Leave empty to allow any.">
        <LinesInput
          value={draft.allowedEmailDomains}
          onChange={(allowedEmailDomains) => set({ allowedEmailDomains })}
          disabled={disabled}
          rows={3}
          placeholder={"yourbank.co.ke"}
        />
      </Section>

      <Section
        title="IP allowlist"
        description="Only allow Sentinel from these networks: one IPv4 or IPv6 address or CIDR range per line (e.g. 196.201.214.0/24). Leave empty to allow any network."
      >
        <LinesInput value={draft.ipAllowlist} onChange={(ipAllowlist) => set({ ipAllowlist })} disabled={disabled} rows={4} placeholder={currentIp ?? "196.201.214.0/24"} />
        <p className="text-xs text-muted-foreground">
          You are connecting from <span className="font-mono">{currentIp ?? "an unknown address"}</span>. An allowlist that doesn&apos;t include it can&apos;t be saved, so you can&apos;t lock yourself out.
          {canEdit && currentIp && !draft.ipAllowlist.map((rule) => rule.trim()).includes(currentIp) ? (
            <>
              {" "}
              <button type="button" className="text-primary underline" onClick={() => set({ ipAllowlist: [...draft.ipAllowlist.filter((rule) => rule.trim()), currentIp] })}>
                Add my address
              </button>
            </>
          ) : null}
        </p>
        <Toggle
          checked={draft.ipAllowlistApi}
          onChange={(ipAllowlistApi) => set({ ipAllowlistApi })}
          disabled={disabled}
          label="Apply to API requests too"
          detail="API calls from other addresses are refused (403). Include your servers' outbound addresses first."
        />
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
              currentIp: currentIp ?? undefined,
              security: {
                ...draft,
                allowedEmailDomains: draft.allowedEmailDomains.map((line) => line.trim()).filter(Boolean),
                ipAllowlist: draft.ipAllowlist.map((line) => line.trim()).filter(Boolean),
              },
            }),
          )
        }
      />
    </>
  );
}
