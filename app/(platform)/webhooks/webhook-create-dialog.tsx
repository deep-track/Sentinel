"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Copy, Check } from "lucide-react";

// NOTE: the real backend only supports ONE webhook URL per client
// (clients.registerWebhook) — there's no per-event subscription concept
// and all terminal verification outcomes go to that single URL. The old
// multi-event-checkbox UI didn't correspond to anything the backend
// actually does, so it's been dropped rather than left as decoration.
//
// Also: webhookSecret is only ever returned by this one call — there is
// no query to retrieve it again later. It must be shown and copied now.

interface WebhookCreateDialogProps {
  clientId: string;
}

export function WebhookCreateDialog({ clientId }: WebhookCreateDialogProps) {
  const router = useRouter();
  const registerWebhook = useMutation(anyApi.clients.registerWebhook);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!url.trim()) {
      setError("Enter an endpoint URL");
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerWebhook({ clientId, webhookUrl: url.trim() });
      setSecret(result.webhookSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set webhook");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setUrl("");
    setSecret(null);
    setCopied(false);
    setError(null);
    router.refresh();
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Set webhook
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret ? "Webhook secret" : "Set webhook endpoint"}</DialogTitle>
        </DialogHeader>

        {secret ? (
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Save this signing secret now — it won&apos;t be shown again. Setting a new
              webhook URL later will generate a new secret and replace this one.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                {secret}
              </code>
              <Button type="button" size="icon" variant="outline" onClick={copySecret}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://your-app.com/webhooks/sentinel"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                All verification outcomes (completed, flagged, failed) are sent to this
                one endpoint — per-event routing isn&apos;t available yet.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {secret ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Setting..." : "Set webhook"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}