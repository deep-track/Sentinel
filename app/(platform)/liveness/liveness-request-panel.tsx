"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// Email delivery isn't supported by the backend (liveness.submit rejects it),
// so only phone-based channels are offered.
type DeliveryMethod = "sms" | "whatsapp";

const METHODS: { value: DeliveryMethod; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];

type LivenessRow = {
  _id: string;
  contact: string;
  method: string;
  status: "pending" | "completed" | "failed";
  deliveryStatus?: "pending" | "sent" | "failed";
  failureReason?: string;
  sentAt?: number;
  createdAt: number;
};

// E.164: leading +, country code, up to 15 digits total.
const E164 = /^\+[1-9]\d{7,14}$/;

function normalizePhone(value: string) {
  return value.replace(/[\s().-]/g, "");
}

export function LivenessRequestPanel({ clientId, canSend }: { clientId: string; canSend: boolean }) {
  const [contact, setContact] = useState("");
  const [method, setMethod] = useState<DeliveryMethod>("sms");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useAuthedQuery(anyApi.liveness.list, { clientId, limit: 50 }) as LivenessRow[] | undefined;
  const submit = useMutation(anyApi.liveness.submit);

  async function handleSend() {
    const phone = normalizePhone(contact);
    if (!E164.test(phone)) {
      setError("Enter the phone number in international format, e.g. +254700000000.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await submit({ clientId, contact: phone, method });
      setContact("");
      toast.success("Liveness link queued for delivery.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to send link"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canSend ? (
        <Card className="p-6 bg-card border-border">
          <p className="text-sm font-medium text-foreground mb-4">
            Send a liveness verification link
          </p>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact">End user&apos;s mobile number</Label>
              <Input
                id="contact"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+254 700 000000"
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Send via</Label>
              <div className="flex gap-2">
                {METHODS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={method === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMethod(option.value)}
                    aria-pressed={method === option.value}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="button" onClick={() => void handleSend()} disabled={sending} className="w-fit">
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {sending ? "Sending..." : "Send verification link"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            Your role can view liveness requests but not send new ones.
          </p>
        </Card>
      )}

      <Card className="bg-card border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Sent requests
          </span>
        </div>

        {requests === undefined ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading liveness requests">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">
              No liveness requests sent yet. The end user completes the
              camera check on their own phone — results show up here.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((req) => (
                <TableRow key={req._id}>
                  <TableCell className="text-foreground">
                    {req.contact}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {req.method}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        req.status === "completed"
                          ? "success"
                          : req.status === "failed"
                          ? "destructive"
                          : "secondary"
                      }
                      title={req.failureReason}
                    >
                      {req.status === "pending" && req.deliveryStatus === "failed" ? "delivery failed" : req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <ClientDate value={req.sentAt ?? req.createdAt} format="PPp" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
