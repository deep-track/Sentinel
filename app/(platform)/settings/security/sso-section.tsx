"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Field, LinesInput, Section, Toggle, inputClass } from "@/components/settings/kit";
import { finishSso, removeSso, startSso, type SsoDetails } from "./sso-actions";

type Provider = "entra_id" | "google_workspace" | "saml" | "oidc";
type Sso = {
  status: "pending" | "connected";
  provider: Provider;
  connectionName: string;
  domains: string[];
  enforce: boolean;
  jitRole?: "compliance_analyst" | "reviewer" | "developer" | "viewer";
  connectedAt?: number;
};

const PROVIDERS: Array<{ value: Provider; label: string; help: string }> = [
  { value: "entra_id", label: "Microsoft Entra ID (Azure AD)", help: "Register an app in Entra ID (App registrations → New), add the redirect URI below, create a client secret, and give it the openid, profile and email permissions." },
  { value: "google_workspace", label: "Google Workspace", help: "Create an OAuth client (Web application) in Google Cloud for your Workspace, add the redirect URI below as an authorised redirect URI." },
  { value: "saml", label: "SAML 2.0 (Okta, ADFS, OneLogin, …)", help: "Create a SAML app in your identity provider with the ACS URL and entity ID below, sending the user's email address. Then paste its sign-in URL and signing certificate." },
  { value: "oidc", label: "OpenID Connect", help: "Create an OIDC web client with the redirect URI below, then paste its discovery URL, client ID and secret." },
];
const JIT_ROLES = [
  { value: "", label: "Nobody: people still need an invitation" },
  { value: "viewer", label: "Viewer / Auditor" },
  { value: "compliance_analyst", label: "Analyst" },
  { value: "reviewer", label: "Reviewer" },
  { value: "developer", label: "Developer" },
];

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <Button type="button" size="icon" variant="outline" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"), () => undefined)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function SsoSection({ clientId, authDomain }: { clientId: string; authDomain: string | null }) {
  const sso = useAuthedQuery(anyApi.sso.get, { clientId }) as Sso | null | undefined;
  if (sso === undefined) return null;
  return (
    <Section
      title="Single sign-on"
      description="Let your team sign in with their company account (Microsoft, Google or your SAML / OIDC provider) instead of a Sentinel password."
    >
      {sso === null ? <StartForm clientId={clientId} /> : sso.status === "pending" ? <FinishForm clientId={clientId} sso={sso} authDomain={authDomain} /> : <Connected clientId={clientId} sso={sso} authDomain={authDomain} />}
    </Section>
  );
}

function StartForm({ clientId }: { clientId: string }) {
  const [provider, setProvider] = useState<Provider>("entra_id");
  const [domains, setDomains] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await startSso(clientId, provider, domains.map((line) => line.trim()).filter(Boolean));
        setBusy(false);
        if (!result.ok) toast.error(result.error);
      }}
    >
      <Field label="Identity provider" htmlFor="sso-provider">
        <select id="sso-provider" className={`${inputClass} sm:w-96`} value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
          {PROVIDERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Your email domains" hint="One per line, e.g. yourbank.co.ke. People with these addresses sign in through your provider.">
        <LinesInput value={domains} onChange={setDomains} rows={2} placeholder="yourbank.co.ke" />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Set up single sign-on
      </Button>
    </form>
  );
}

function callbackLines(provider: Provider, connectionName: string, authDomain: string | null) {
  if (!authDomain) return [];
  const tenant = authDomain.split(".")[0];
  if (provider === "saml") {
    return [
      { label: "ACS (reply) URL", value: `https://${authDomain}/login/callback?connection=${connectionName}` },
      { label: "Entity ID (audience)", value: `urn:auth0:${tenant}:${connectionName}` },
    ];
  }
  return [{ label: "Redirect URI", value: `https://${authDomain}/login/callback` }];
}

function FinishForm({ clientId, sso, authDomain }: { clientId: string; sso: Sso; authDomain: string | null }) {
  const cancel = useMutation(anyApi.sso.cancelPending);
  const [details, setDetails] = useState<SsoDetails>({});
  const [busy, setBusy] = useState(false);
  const provider = PROVIDERS.find((option) => option.value === sso.provider)!;
  const set = (key: keyof SsoDetails) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDetails((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await finishSso(clientId, details);
        setBusy(false);
        if (result.ok) toast.success("Single sign-on connected. Test it before you require it.");
        else toast.error(result.error);
      }}
    >
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="font-medium">1. In {provider.label}</p>
        <p className="mt-1 text-muted-foreground">{provider.help}</p>
        <div className="mt-2 space-y-1.5">
          {callbackLines(sso.provider, sso.connectionName, authDomain).map((line) => (
            <CopyLine key={line.label} {...line} />
          ))}
        </div>
      </div>
      <p className="text-sm font-medium">2. Paste its details for {sso.domains.join(", ")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {sso.provider === "entra_id" ? (
          <Field label="Tenant domain" htmlFor="sso-tenant">
            <input id="sso-tenant" className={inputClass} placeholder="yourbank.onmicrosoft.com" value={details.tenantDomain ?? ""} onChange={set("tenantDomain")} required />
          </Field>
        ) : null}
        {sso.provider === "oidc" ? (
          <Field label="Discovery URL" htmlFor="sso-discovery">
            <input id="sso-discovery" className={inputClass} placeholder="https://idp.example/.well-known/openid-configuration" value={details.discoveryUrl ?? ""} onChange={set("discoveryUrl")} required />
          </Field>
        ) : null}
        {sso.provider !== "saml" ? (
          <>
            <Field label="Client ID" htmlFor="sso-client-id">
              <input id="sso-client-id" className={inputClass} value={details.clientIdValue ?? ""} onChange={set("clientIdValue")} required />
            </Field>
            <Field label="Client secret" htmlFor="sso-secret" hint="Sent straight to Auth0; Sentinel doesn't store it.">
              <input id="sso-secret" type="password" autoComplete="off" className={inputClass} value={details.clientSecret ?? ""} onChange={set("clientSecret")} required />
            </Field>
          </>
        ) : (
          <>
            <Field label="Sign-in URL" htmlFor="sso-signin">
              <input id="sso-signin" className={inputClass} placeholder="https://idp.example/sso/saml" value={details.signInUrl ?? ""} onChange={set("signInUrl")} required />
            </Field>
            <Field label="Sign-out URL (optional)" htmlFor="sso-signout">
              <input id="sso-signout" className={inputClass} value={details.signOutUrl ?? ""} onChange={set("signOutUrl")} />
            </Field>
          </>
        )}
      </div>
      {sso.provider === "saml" ? (
        <Field label="Signing certificate (PEM)" htmlFor="sso-cert">
          <textarea id="sso-cert" rows={5} className={`${inputClass} font-mono text-xs`} placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"} value={details.certificate ?? ""} onChange={set("certificate")} required />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Connect
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel({ clientId })}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Connected({ clientId, sso, authDomain }: { clientId: string; sso: Sso; authDomain: string | null }) {
  const setOptions = useMutation(anyApi.sso.setOptions);
  const [busy, setBusy] = useState(false);
  const provider = PROVIDERS.find((option) => option.value === sso.provider)!;
  async function save(enforce: boolean, jitRole: string) {
    setBusy(true);
    try {
      await setOptions({ clientId, enforce, jitRole: jitRole || null });
      toast.success("Single sign-on settings saved");
    } catch (error) {
      toast.error(getErrorMessage(error, "The settings couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }
  const testUrl = `/auth/login?${new URLSearchParams({ connection: sso.connectionName, prompt: "login", returnTo: "/settings/security" })}`;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Connected to <span className="font-medium">{provider.label}</span> for <span className="font-medium">{sso.domains.join(", ")}</span>.
      </p>
      <div className="space-y-1.5">
        {callbackLines(sso.provider, sso.connectionName, authDomain).map((line) => (
          <CopyLine key={line.label} {...line} />
        ))}
      </div>
      <div>
        <Button asChild variant="outline" size="sm">
          <a href={testUrl}>Test sign-in with your company account</a>
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">Signs you out of this session and back in through your provider.</p>
      </div>
      <Toggle
        checked={sso.enforce}
        disabled={busy}
        onChange={(enforce) => {
          if (enforce && !window.confirm(`Require single sign-on? Everyone at ${sso.domains.join(", ")} must sign in through ${provider.label}; password sign-ins are sent back to sign in again. Test it first.`)) return;
          void save(enforce, sso.jitRole ?? "");
        }}
        label={`Require single sign-on for ${sso.domains.join(", ")}`}
        detail="DeepTrack staff and members at other domains are not affected."
      />
      <Field label="New people who sign in with SSO" htmlFor="sso-jit" hint="Without an invite, they join with this role (within your seat limit). Choose Nobody to keep invitations required.">
        <select id="sso-jit" className={`${inputClass} sm:w-80`} disabled={busy} value={sso.jitRole ?? ""} onChange={(event) => void save(sso.enforce, event.target.value)}>
          {JIT_ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Remove single sign-on? People who only sign in with it lose access until they set a password or you connect it again.")) return;
          setBusy(true);
          const result = await removeSso(clientId);
          setBusy(false);
          if (result.ok) toast.success("Single sign-on removed");
          else toast.error(result.error);
        }}
      >
        Remove single sign-on
      </Button>
    </div>
  );
}
