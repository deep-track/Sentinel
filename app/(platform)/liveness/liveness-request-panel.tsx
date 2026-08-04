"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Send, Smartphone } from "lucide-react";

type DeliveryMethod = "sms" | "whatsapp" | "email";

type LivenessRequest = {
  id: string;
  contact: string;
  method: DeliveryMethod;
  status: "pending" | "completed" | "failed";
  sentAt: Date;
};

// TODO(backend): wire this to the real endpoint once it exists. Per the
// operator flow, this should trigger the backend to generate a unique
// liveness link and dispatch it via SMS/WhatsApp/email to the end user's
// phone. The end user completes the camera check on their own device —
// nothing about that step happens in this web app. This function
// intentionally does not pretend to succeed against a real backend yet.
/* eslint-disable @typescript-eslint/no-unused-vars */
async function sendLivenessLink(
  contact: string,
  method: DeliveryMethod
): Promise<never> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  throw new Error(
    "Link-sending endpoint isn't built yet — no request was actually sent."
  );
}

export function LivenessRequestPanel() {
  const [contact, setContact] = useState("");
  const [method, setMethod] = useState<DeliveryMethod>("sms");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [requests, setRequests] = useState<LivenessRequest[]>([]);

  async function handleSend() {
    if (!contact) {
      setError("Enter a phone number or email first");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendLivenessLink(contact, method);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send link");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6 bg-card border-border">
        <p className="text-sm font-medium text-foreground mb-4">
          Send a liveness verification link
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact">End user&apos;s phone or email</Label>
            <Input
              id="contact"
              placeholder="+254 700 000000 or name@example.com"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Send via</Label>
            <div className="flex gap-2">
              {(["sms", "whatsapp", "email"] as DeliveryMethod[]).map(
                (option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={method === option ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMethod(option)}
                    className="capitalize"
                  >
                    {option}
                  </Button>
                )
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleSend} disabled={sending} className="w-fit">
            <Send className="h-4 w-4 mr-2" />
            {sending ? "Sending..." : "Send verification link"}
          </Button>
        </div>
      </Card>

      <Card className="bg-card border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Sent requests
          </span>
        </div>

        {requests.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">
              No liveness requests sent yet. The end user completes the
              camera check on their own phone — results will show up here
              once the review pipeline is connected.
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
                <TableRow key={req.id}>
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
                    >
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {req.sentAt.toLocaleString()}
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