"use client";

import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
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

type Notifications = ResolvedSettings["notifications"];

export function NotificationSettings({ clientId }: { clientId: string }) {
  const data = useSettings(clientId);
  const { draft, setDraft, dirty, reset } = useDraft<Notifications>(data?.settings.notifications);
  const save = useMutation(anyApi.orgSettings.saveNotifications);
  const { saving, run } = useSave();

  if (data === undefined || (data && !draft)) return <SettingsLoading />;
  if (data === null || !draft) return <SettingsUnavailable />;
  const { options, canEdit, client } = data;
  const disabled = !canEdit;
  const roles = options.roles;

  const setEvent = (event: string, patch: Partial<Notifications["events"][string]>) =>
    setDraft((current) => ({ ...current, events: { ...current.events, [event]: { ...current.events[event], ...patch } } }));

  return (
    <>
      <ReadOnlyNotice canEdit={canEdit} />
      <Section
        title="Alerts"
        description="Every alert appears in the bell at the top of Sentinel for the people it goes to. Tick Email to also send it by email."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Alert</th>
                <th className="p-3">On</th>
                <th className="p-3">Email</th>
                <th className="p-3">Who gets it</th>
              </tr>
            </thead>
            <tbody>
              {options.events.map((event) => {
                const value = draft.events[event.value];
                return (
                  <tr key={event.value} className="border-b last:border-0 align-top">
                    <td className="p-3">
                      <p className="font-medium">{event.label}</p>
                      <p className="text-xs text-muted-foreground">{event.detail}</p>
                    </td>
                    <td className="p-3">
                      <input type="checkbox" aria-label={`${event.label} on`} className="h-4 w-4 accent-primary" disabled={disabled} checked={value.enabled} onChange={(change) => setEvent(event.value, { enabled: change.target.checked })} />
                    </td>
                    <td className="p-3">
                      <input type="checkbox" aria-label={`${event.label} by email`} className="h-4 w-4 accent-primary" disabled={disabled || !value.enabled} checked={value.email} onChange={(change) => setEvent(event.value, { email: change.target.checked })} />
                    </td>
                    <td className="p-3">
                      {event.personal ? (
                        <span className="text-xs text-muted-foreground">{event.value === "review_assigned" ? "The person the case is assigned to" : "People who can approve it"}</span>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {roles.map((role) => (
                            <label key={role.value} className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-primary"
                                disabled={disabled || !value.enabled}
                                checked={value.roles.includes(role.value)}
                                onChange={(change) =>
                                  setEvent(event.value, {
                                    roles: change.target.checked ? [...value.roles, role.value] : value.roles.filter((item) => item !== role.value),
                                  })
                                }
                              />
                              {role.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Low-credit warning" description="When the credit balance falls to this level, the Low credits alert goes out once (again after a top-up).">
        <Toggle
          checked={draft.lowCreditBalance === null}
          onChange={(useDefault) => setDraft((current) => ({ ...current, lowCreditBalance: useDefault ? null : client.lowCreditDefault }))}
          disabled={disabled}
          label={`Use your plan's warning level (${client.lowCreditDefault.toLocaleString("en-US")} credits)`}
        />
        {draft.lowCreditBalance !== null ? (
          <Field label="Warn at (credits)" htmlFor="low-credit">
            <input
              id="low-credit"
              type="number"
              min={0}
              className={`${inputClass} sm:w-48`}
              disabled={disabled}
              value={draft.lowCreditBalance}
              onChange={(event) => setDraft((current) => ({ ...current, lowCreditBalance: Number(event.target.value) }))}
            />
          </Field>
        ) : null}
        {client.creditBalance !== null ? <p className="text-xs text-muted-foreground">Current balance: {client.creditBalance.toLocaleString("en-US")} credits.</p> : null}
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
              notifications: {
                events: draft.events,
                ...(draft.lowCreditBalance !== null ? { lowCreditBalance: draft.lowCreditBalance } : {}),
              },
            }),
          )
        }
      />
    </>
  );
}
