"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { AlertTriangle, Check, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/modules/shared/errors";
import { validateWebhookUrl } from "@/modules/shared/webhook-url";

// NOTE: the backend only supports ONE webhook URL per client
// (clients.registerWebhook) — there's no per-event subscription concept and
// all terminal verification outcomes go to that single URL.
//
// webhookSecret is only ever returned by this one call — there is no query
// to retrieve it again later, and registering rotates (invalidates) the
// previous secret immediately. So: confirm before rotating, and don't let
// the dialog be dismissed while the new secret is on screen until the user
// confirms they've stored it.

type Stage = "edit" | "confirm" | "secret";

interface WebhookCreateDialogProps {
  clientId: string;
}

export function WebhookCreateDialog({ clientId }: WebhookCreateDialogProps) {
  const router = useRouter();
  const registerWebhook = useMutation(anyApi.clients.registerWebhook);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("edit");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  function reset() {
    setStage("edit");
    setUrl("");
    setSecret(null);
    setCopied(false);
    setAcknowledged(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true);
      return;
    }
    if (submitting) return;
    if (secret && !acknowledged) {
      toast.warning("Copy the signing secret and confirm you've stored it before closing — it can't be shown again.");
      return;
    }
    const hadSecret = Boolean(secret);
    setOpen(false);
    reset();
    if (hadSecret) router.refresh();
  }

  function handleContinue() {
    const problem = validateWebhookUrl(url);
    setError(problem);
    if (!problem) setStage("confirm");
  }

  async function handleRegister() {
    setError(null);
    setSubmitting(true);
    try {
      const result: { webhookSecret: string } = await registerWebhook({ clientId, webhookUrl: url.trim() });
      setSecret(result.webhookSecret);
      setStage("secret");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to set webhook"));
      setStage("edit");
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the secret and copy it manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Set webhook
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {stage === "secret" ? "Webhook signing secret" : stage === "confirm" ? "Replace webhook endpoint?" : "Set webhook endpoint"}
          </DialogTitle>
          <DialogDescription>
            {stage === "secret"
              ? "Your endpoint is registered."
              : "All verification outcomes are delivered to a single HTTPS endpoint."}
          </DialogDescription>
        </DialogHeader>

        {stage === "secret" && secret ? (
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Save this signing secret now — it won&apos;t be shown again. The previous secret
              (if any) has stopped working.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">{secret}</code>
              <Button type="button" size="icon" variant="outline" onClick={() => void copySecret()} aria-label="Copy secret">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I&apos;ve copied and stored this secret.</span>
            </label>
          </div>
        ) : stage === "confirm" ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                This replaces any existing webhook URL and <strong>immediately rotates the signing secret</strong>.
                Deliveries signed with the old secret will fail verification until you update your receiver.
              </p>
            </div>
            <p className="text-sm">
              New endpoint: <code className="font-mono text-xs break-all">{url.trim()}</code>
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                type="url"
                inputMode="url"
                placeholder="https://your-app.com/webhooks/sentinel"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={Boolean(error)}
              />
              <p className="text-xs text-muted-foreground">
                Must be a public https:// URL. All verification outcomes (completed, flagged, failed)
                are sent to this one endpoint.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          {stage === "secret" ? (
            <Button type="button" disabled={!acknowledged} onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          ) : stage === "confirm" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStage("edit")} disabled={submitting}>
                Back
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleRegister()} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Replace & rotate secret"
                )}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleContinue}>
                Continue
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
