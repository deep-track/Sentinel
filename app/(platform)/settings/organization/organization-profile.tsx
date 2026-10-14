"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/modules/shared/errors";
import {
  Field,
  ReadOnlyNotice,
  SaveBar,
  Section,
  SettingsLoading,
  SettingsUnavailable,
  inputClass,
  useDraft,
  useSave,
  useSettings,
  type ResolvedSettings,
} from "@/components/settings/kit";

type Profile = ResolvedSettings["profile"];
const MAX_LOGO_BYTES = 1024 * 1024;

const TEXT_FIELDS: Array<{ key: keyof Profile; label: string; placeholder?: string; hint?: string; type?: string }> = [
  { key: "legalName", label: "Legal name", placeholder: "Example Bank Kenya PLC" },
  { key: "registrationNumber", label: "Registration number", placeholder: "PVT-…" },
  { key: "licenceNumber", label: "Licence number" },
  { key: "address", label: "Registered address" },
  { key: "city", label: "City", placeholder: "Nairobi" },
  { key: "complianceContactName", label: "Compliance contact", placeholder: "Name of the CRO or MLRO", hint: "The reporting person on STRs." },
  { key: "complianceContactEmail", label: "Compliance contact email", type: "email" },
  { key: "complianceContactPhone", label: "Compliance contact phone", type: "tel" },
  { key: "goamlEntityId", label: "goAML reporting entity ID", hint: "Assigned by the Financial Reporting Centre when you registered on goAML. Needed to prepare STRs." },
  { key: "goamlBranch", label: "goAML branch (optional)" },
];

export function OrganizationProfile({ clientId }: { clientId: string }) {
  const data = useSettings(clientId);
  const { draft, setDraft, dirty, reset } = useDraft<Profile>(data?.settings.profile);
  const save = useMutation(anyApi.orgSettings.saveProfile);
  const { saving, run } = useSave();

  if (data === undefined || (data && !draft)) return <SettingsLoading />;
  if (data === null || !draft) return <SettingsUnavailable />;
  const { canEdit, options } = data;
  const disabled = !canEdit;
  const set = (patch: Partial<Profile>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <>
      <ReadOnlyNotice canEdit={canEdit} />
      <Section title="Logo" description="Shown on the reports your team downloads (AML screening reports).">
        <LogoUpload clientId={clientId} logoUrl={data.logoUrl} canEdit={canEdit} />
      </Section>
      <Section title="Organization details" description={`How ${data.client.name} appears on reports and to DeepTrack.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} htmlFor={`profile-${field.key}`} hint={field.hint}>
              <input
                id={`profile-${field.key}`}
                type={field.type ?? "text"}
                className={inputClass}
                maxLength={300}
                disabled={disabled}
                placeholder={field.placeholder}
                value={(draft[field.key] as string | undefined) ?? ""}
                onChange={(event) => set({ [field.key]: event.target.value })}
              />
            </Field>
          ))}
          <Field label="Regulator" htmlFor="profile-regulator">
            <select
              id="profile-regulator"
              className={inputClass}
              disabled={disabled}
              value={draft.regulator ?? ""}
              onChange={(event) => set({ regulator: event.target.value || undefined })}
            >
              <option value="">Not set</option>
              {options.regulators.map((regulator) => (
                <option key={regulator.value} value={regulator.value}>
                  {regulator.label}
                </option>
              ))}
            </select>
          </Field>
          {draft.regulator === "other" ? (
            <Field label="Regulator name" htmlFor="profile-regulator-other">
              <input id="profile-regulator-other" className={inputClass} maxLength={300} disabled={disabled} value={draft.regulatorOther ?? ""} onChange={(event) => set({ regulatorOther: event.target.value })} />
            </Field>
          ) : null}
        </div>
      </Section>
      <SaveBar
        canEdit={canEdit}
        dirty={dirty}
        saving={saving}
        onReset={reset}
        onSave={() => {
          // The logo is saved by its own upload, not with the form.
          const profile = { ...draft };
          delete profile.logoStorageId;
          void run(() => save({ clientId, profile }));
        }}
      />
    </>
  );
}

function LogoUpload({ clientId, logoUrl, canEdit }: { clientId: string; logoUrl: string | null; canEdit: boolean }) {
  const generateUrl = useMutation(anyApi.orgSettings.generateLogoUploadUrl);
  const setLogo = useMutation(anyApi.orgSettings.setLogo);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_LOGO_BYTES) {
      toast.error("Use a PNG, JPEG or WebP image of at most 1 MB.");
      return;
    }
    setBusy(true);
    try {
      const url = (await generateUrl({ clientId })) as string;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as { storageId: string };
      await setLogo({ clientId, storageId });
      toast.success("Logo updated");
    } catch (error) {
      toast.error(getErrorMessage(error, "The logo couldn't be uploaded."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function removeLogo() {
    setBusy(true);
    try {
      await setLogo({ clientId });
      toast.success("Logo removed");
    } catch (error) {
      toast.error(getErrorMessage(error, "The logo couldn't be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-16 w-40 items-center justify-center rounded-lg border bg-muted/30">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Organization logo" className="max-h-14 max-w-36 object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">No logo</span>
        )}
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImageUp className="mr-1.5 h-4 w-4" />}
            {logoUrl ? "Replace" : "Upload"}
          </Button>
          {logoUrl ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void removeLogo()}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Remove
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="w-full text-xs text-muted-foreground">PNG, JPEG or WebP, up to 1 MB. A wide logo on a transparent background works best.</p>
    </div>
  );
}
