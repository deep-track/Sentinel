"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { WebhookCreateDialog } from "@/app/(platform)/webhooks/webhook-create-dialog";

// The organization's webhook: endpoint, the events it receives, and the
// latest deliveries with a resend for failed ones.

type Webhook = {
  webhookUrl: string | null;
  configured: boolean;
  events: string[];
  eventOptions: Array<{ value: string; label: string }>;
  deliveries: Array<{
    _id: string;
    status: "pending" | "delivered" | "retrying" | "failed";
    event: string | null;
    reference: string | null;
    attemptCount: number;
    lastAttemptAt: number | null;
    nextRetryAt: number | null;
    lastResponseStatus: number | null;
    createdAt: number;
  }>;
};

const STATUS_STYLE: Record<Webhook["deliveries"][number]["status"], string> = {
  delivered: "bg-emerald-600 text-white hover:bg-emerald-600",
  pending: "",
  retrying: "border-amber-300 text-amber-700",
  failed: "border-red-300 text-red-700",
};

export function WebhooksPanel({ clientId, canManage, canResend }: { clientId: string; canManage: boolean; canResend: boolean }) {
  const data = useAuthedQuery(anyApi.webhooks.getForClient, { clientId }) as Webhook | null | undefined;
  const setEvents = useMutation(anyApi.webhooks.setEvents);
  const resend = useMutation(anyApi.webhooks.resendWebhook);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  if (data === null) return null;

  async function toggleEvent(value: string, on: boolean) {
    const next = on ? [...data!.events, value] : data!.events.filter((event) => event !== value);
    setBusy(true);
    try {
      await setEvents({ clientId, events: next });
      toast.success("Webhook events saved");
    } catch (error) {
      toast.error(getErrorMessage(error, "The events couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Webhook</h2>
          <p className="text-sm text-muted-foreground">
            {data.configured ? (
              <>
                Sending to <span className="font-mono">{data.webhookUrl}</span>, signed with your secret (X-Sentinel-Signature).
              </>
            ) : (
              "No endpoint set. Set one to get each result as soon as a check completes."
            )}
          </p>
        </div>
        {canManage ? <WebhookCreateDialog clientId={clientId} /> : null}
      </div>
      <div className="space-y-2 border-b px-5 py-4">
        <p className="text-sm font-medium">Events</p>
        {data.eventOptions.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              disabled={!canManage || busy}
              checked={data.events.includes(option.value)}
              onChange={(event) => void toggleEvent(option.value, event.target.checked)}
            />
            <span>
              {option.label} <span className="font-mono text-xs text-muted-foreground">{option.value}</span>
            </span>
          </label>
        ))}
        {!canManage ? <p className="text-xs text-muted-foreground">Only Admins and Developers can change the webhook.</p> : null}
      </div>
      <div>
        <p className="px-5 pt-4 text-sm font-medium">Recent deliveries</p>
        {data.deliveries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Scan</th>
                  <th className="p-3">Event</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Attempts</th>
                  <th className="p-3">Response</th>
                  {canResend ? <th className="p-3" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((delivery) => (
                  <tr key={delivery._id} className="border-b last:border-0">
                    <td className="p-3 text-muted-foreground">
                      <ClientDate value={delivery.createdAt} format="PPp" />
                    </td>
                    <td className="p-3 font-mono text-xs">{delivery.reference ?? "—"}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{delivery.event ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant={delivery.status === "delivered" ? "default" : "outline"} className={STATUS_STYLE[delivery.status]}>
                        {delivery.status}
                      </Badge>
                      {delivery.status === "retrying" && delivery.nextRetryAt ? (
                        <p className="text-xs text-muted-foreground">
                          next <ClientDate value={delivery.nextRetryAt} format="p" />
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3">{delivery.attemptCount}</td>
                    <td className="p-3 text-muted-foreground">{delivery.lastResponseStatus ?? "—"}</td>
                    {canResend ? (
                      <td className="p-3 text-right">
                        {delivery.status === "failed" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              resend({ deliveryId: delivery._id }).then(
                                () => toast.success("Resending"),
                                (error) => toast.error(getErrorMessage(error, "Couldn't resend.")),
                              )
                            }
                          >
                            <RotateCw className="mr-1 h-3.5 w-3.5" /> Resend
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
