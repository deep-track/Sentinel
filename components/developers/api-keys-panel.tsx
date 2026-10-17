"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus, RotateCw, Ban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// API keys for the selected organization: name, scopes, rotation (the old
// key keeps working for 24 hours) and revocation. Admins and Developers
// manage them; everyone else sees them by prefix only.

type Key = {
  _id: string;
  prefix: string;
  environment: "live" | "test";
  revoked: boolean;
  expired: boolean;
  expiresAt: number | null;
  label: string | null;
  scopes: string[] | null;
  rotated: boolean;
  createdAt: number;
  lastUsedAt?: number;
};
type Scope = { value: string; label: string };

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function ApiKeysPanel({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const keys = useAuthedQuery(anyApi.apiKeys.listForClient, { clientId }) as Key[] | undefined;
  const scopes = useAuthedQuery(anyApi.apiKeys.scopes, {}) as Scope[] | undefined;
  const [editing, setEditing] = useState<Key | "new" | null>(null);
  const [secret, setSecret] = useState<{ rawKey: string; note?: string } | null>(null);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">API keys</h2>
          <p className="text-sm text-muted-foreground">Test keys return sandbox results and are never charged. Keys are shown by prefix only.</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 h-4 w-4" /> New key
          </Button>
        ) : null}
      </div>
      {!canManage ? <p className="border-b px-5 py-2 text-xs text-muted-foreground">Only Admins and Developers can create, rotate or revoke keys.</p> : null}
      {keys === undefined ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : keys.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Key</th>
                <th className="p-3">Scopes</th>
                <th className="p-3">Created</th>
                <th className="p-3">Last used</th>
                <th className="p-3">Status</th>
                {canManage ? <th className="p-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <KeyRow key={key._id} apiKey={key} scopes={scopes ?? []} canManage={canManage} onEdit={() => setEditing(key)} onSecret={setSecret} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null ? (
        <KeyDialog clientId={clientId} apiKey={editing === "new" ? null : editing} scopes={scopes ?? []} onClose={() => setEditing(null)} onSecret={setSecret} />
      ) : null}
      {secret ? <SecretDialog rawKey={secret.rawKey} note={secret.note} onClose={() => setSecret(null)} /> : null}
    </Card>
  );
}

function status(key: Key) {
  if (key.revoked) return <Badge variant="outline">Revoked</Badge>;
  if (key.expired) return <Badge variant="outline">Expired</Badge>;
  if (key.expiresAt) {
    return (
      <Badge variant="outline" className="border-amber-300 text-amber-700">
        Rotated · works until <ClientDate value={key.expiresAt} format="PPp" />
      </Badge>
    );
  }
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Active</Badge>;
}

function KeyRow({
  apiKey,
  scopes,
  canManage,
  onEdit,
  onSecret,
}: {
  apiKey: Key;
  scopes: Scope[];
  canManage: boolean;
  onEdit: () => void;
  onSecret: (secret: { rawKey: string; note?: string }) => void;
}) {
  const rotate = useMutation(anyApi.apiKeys.rotate);
  const revoke = useMutation(anyApi.apiKeys.revoke);
  const [busy, setBusy] = useState(false);
  const usable = !apiKey.revoked && !apiKey.expired;
  const scopeLabel = apiKey.scopes === null ? "All" : apiKey.scopes.map((scope) => scopes.find((item) => item.value === scope)?.label ?? scope).join(", ");

  async function doRotate() {
    if (!window.confirm("Rotate this key? You get a new key now; the old one keeps working for 24 hours so you can deploy the new one.")) return;
    setBusy(true);
    try {
      const result = (await rotate({ keyId: apiKey._id })) as { rawKey: string; oldKeyExpiresAt: number };
      onSecret({ rawKey: result.rawKey, note: `The old key stops working on ${new Date(result.oldKeyExpiresAt).toLocaleString()}.` });
    } catch (error) {
      toast.error(getErrorMessage(error, "The key couldn't be rotated."));
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke() {
    if (!window.confirm("Revoke this key now? Requests using it fail immediately.")) return;
    setBusy(true);
    try {
      await revoke({ keyId: apiKey._id });
      toast.success("Key revoked");
    } catch (error) {
      toast.error(getErrorMessage(error, "The key couldn't be revoked."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`border-b last:border-0 align-top ${usable ? "" : "opacity-60"}`}>
      <td className="p-3">
        <p className="font-medium">{apiKey.label ?? `${apiKey.environment === "test" ? "Test" : "Live"} key`}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {apiKey.prefix}… · {apiKey.environment}
        </p>
      </td>
      <td className="p-3 text-xs text-muted-foreground max-w-[260px]">{scopeLabel}</td>
      <td className="p-3 text-muted-foreground">
        <ClientDate value={apiKey.createdAt} format="PP" />
      </td>
      <td className="p-3 text-muted-foreground">{apiKey.lastUsedAt ? <ClientDate value={apiKey.lastUsedAt} format="PPp" /> : "Never"}</td>
      <td className="p-3">{status(apiKey)}</td>
      {canManage ? (
        <td className="p-3">
          {usable ? (
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={busy} aria-label="Edit name and scopes">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {!apiKey.rotated ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void doRotate()} disabled={busy}>
                  <RotateCw className="mr-1 h-3.5 w-3.5" /> Rotate
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={() => void doRevoke()} disabled={busy}>
                <Ban className="mr-1 h-3.5 w-3.5" /> Revoke
              </Button>
            </div>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

function KeyDialog({
  clientId,
  apiKey,
  scopes,
  onClose,
  onSecret,
}: {
  clientId: string;
  apiKey: Key | null;
  scopes: Scope[];
  onClose: () => void;
  onSecret: (secret: { rawKey: string }) => void;
}) {
  const create = useMutation(anyApi.apiKeys.createForClient);
  const update = useMutation(anyApi.apiKeys.updateKey);
  const [label, setLabel] = useState(apiKey?.label ?? "");
  const [environment, setEnvironment] = useState<"live" | "test">(apiKey?.environment ?? "test");
  const [allScopes, setAllScopes] = useState(apiKey ? apiKey.scopes === null : true);
  const [chosen, setChosen] = useState<string[]>(apiKey?.scopes ?? scopes.map((scope) => scope.value));
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!allScopes && chosen.length === 0) {
      toast.error("Choose at least one scope.");
      return;
    }
    setBusy(true);
    try {
      const scopeArg = allScopes ? (apiKey ? scopes.map((scope) => scope.value) : undefined) : chosen;
      if (apiKey) {
        await update({ keyId: apiKey._id, label: label.trim() || undefined, scopes: scopeArg });
        toast.success("Key updated");
        onClose();
      } else {
        const result = (await create({ clientId, environment, label: label.trim() || undefined, scopes: scopeArg })) as { rawKey: string };
        onClose();
        onSecret({ rawKey: result.rawKey });
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "The key couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{apiKey ? "Edit API key" : "New API key"}</DialogTitle>
            <DialogDescription>Give each integration its own key with only the scopes it needs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="key-label" className="text-sm font-medium">
              Name
            </label>
            <input id="key-label" className={inputClass} value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Core banking onboarding" />
          </div>
          {!apiKey ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Environment</p>
              <div className="grid grid-cols-2 gap-2">
                {(["test", "live"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEnvironment(value)}
                    aria-pressed={environment === value}
                    className={`rounded-lg border-2 p-3 text-left text-sm ${environment === value ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <span className="font-medium capitalize">{value}</span>
                    <span className="block text-xs text-muted-foreground">{value === "test" ? "Sandbox results, no charges." : "Real checks, billed."}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">Scopes</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={allScopes} onChange={(event) => setAllScopes(event.target.checked)} />
              Everything
            </label>
            {!allScopes ? (
              <div className="grid gap-1.5 pl-6">
                {scopes.map((scope) => (
                  <label key={scope.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={chosen.includes(scope.value)}
                      onChange={(event) => setChosen((current) => (event.target.checked ? [...current, scope.value] : current.filter((item) => item !== scope.value)))}
                    />
                    {scope.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              {apiKey ? "Save" : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The raw key is returned once; don't let it be dismissed until the user
// confirms they've stored it.
function SecretDialog({ rawKey, note, onClose }: { rawKey: string; note?: string; onClose: () => void }) {
  const [stored, setStored] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !stored) {
          toast.warning("Copy the key and confirm you've stored it before closing.");
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
          <DialogDescription>This is the only time it&apos;s shown. Store it in your secrets manager now.{note ? ` ${note}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <code className="flex-1 break-all text-xs">{rawKey}</code>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Copy key"
            onClick={() =>
              navigator.clipboard.writeText(rawKey).then(
                () => toast.success("Copied"),
                () => toast.error("Couldn't copy. Select the key and copy it."),
              )
            }
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={stored} onChange={(event) => setStored(event.target.checked)} />
          I&apos;ve copied and stored this key.
        </label>
        <DialogFooter>
          <Button type="button" disabled={!stored} onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
