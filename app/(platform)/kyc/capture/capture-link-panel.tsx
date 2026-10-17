"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

type Method = "whatsapp" | "sms" | "link";
type Row = {
  _id: string;
  method: Method;
  contact: string | null;
  language: "en" | "sw";
  externalRef: string | null;
  name: string | null;
  status: "pending" | "opened" | "submitted" | "expired" | "cancelled";
  deliveryStatus: "not_sent" | "pending" | "sent" | "failed";
  deliveryFailure: string | null;
  createdAt: number;
  expiresAt: number;
  verificationId: string | null;
  reference: string | null;
};

const METHODS: Array<{ value: Method; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "link", label: "Copy link" },
];

const STATUS_LABEL: Record<Row["status"], string> = { pending: "Sent", opened: "Opened", submitted: "Submitted", expired: "Expired", cancelled: "Cancelled" };

export function CaptureLinkPanel({ clientId, canSend }: { clientId: string; canSend: boolean }) {
  const [method, setMethod] = useState<Method>("whatsapp");
  const [contact, setContact] = useState("");
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const [prefill, setPrefill] = useState({ firstName: "", lastName: "", idNumber: "", dateOfBirth: "", gender: "" });
  const [externalRef, setExternalRef] = useState("");
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const rows = useAuthedQuery(anyApi.capture.list, { clientId, limit: 50 }) as Row[] | undefined;
  const create = useMutation(anyApi.capture.create);
  const cancel = useMutation(anyApi.capture.cancel);

  async function handleCreate() {
    setSending(true);
    setLink(null);
    try {
      const filled = Object.fromEntries(Object.entries(prefill).filter(([, value]) => value.trim()));
      const result = (await create({
        clientId,
        method,
        language,
        ...(method !== "link" ? { contact: contact.replace(/[\s().-]/g, "") } : {}),
        ...(Object.keys(filled).length ? { prefill: filled } : {}),
        ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
      })) as { link: string };
      if (method === "link") {
        setLink(result.link);
        await navigator.clipboard?.writeText(result.link).catch(() => undefined);
        toast.success("Link created and copied. It's shown only now.");
      } else {
        toast.success(`Link queued for ${method === "sms" ? "SMS" : "WhatsApp"}.`);
      }
      setContact("");
      setPrefill({ firstName: "", lastName: "", idNumber: "", dateOfBirth: "", gender: "" });
      setExternalRef("");
    } catch (error) {
      toast.error(getErrorMessage(error, "The link couldn't be created."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canSend ? (
        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap gap-2">
            {METHODS.map((option) => (
              <Button key={option.value} type="button" size="sm" variant={method === option.value ? "default" : "outline"} onClick={() => setMethod(option.value)} aria-pressed={method === option.value}>
                {option.label}
              </Button>
            ))}
            <span className="mx-2 border-l" />
            {(["en", "sw"] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={language === value ? "default" : "outline"} onClick={() => setLanguage(value)} aria-pressed={language === value}>
                {value === "en" ? "English" : "Kiswahili"}
              </Button>
            ))}
          </div>
          {method !== "link" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="capture-contact">Customer&apos;s mobile number</Label>
              <Input id="capture-contact" type="tel" inputMode="tel" placeholder="+254 700 000000" value={contact} onChange={(event) => setContact(event.target.value)} />
            </div>
          ) : null}
          <div>
            <p className="mb-2 text-sm font-medium">Customer details (optional)</p>
            <p className="mb-3 text-xs text-muted-foreground">What you fill in here isn&apos;t asked again; the customer types the rest. Only the first name is shown on their page.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="First name" value={prefill.firstName} onChange={(event) => setPrefill({ ...prefill, firstName: event.target.value })} maxLength={100} />
              <Input placeholder="Last name" value={prefill.lastName} onChange={(event) => setPrefill({ ...prefill, lastName: event.target.value })} maxLength={100} />
              <Input placeholder="ID or passport number" value={prefill.idNumber} onChange={(event) => setPrefill({ ...prefill, idNumber: event.target.value })} maxLength={100} />
              <Input type="date" aria-label="Date of birth" value={prefill.dateOfBirth} onChange={(event) => setPrefill({ ...prefill, dateOfBirth: event.target.value })} />
              <select aria-label="Gender" value={prefill.gender} onChange={(event) => setPrefill({ ...prefill, gender: event.target.value })} className="h-9 rounded-md border bg-transparent px-3 text-sm">
                <option value="">Gender (customer picks)</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
              <Input placeholder="Your reference" value={externalRef} onChange={(event) => setExternalRef(event.target.value)} maxLength={100} />
            </div>
          </div>
          <Button type="button" onClick={handleCreate} disabled={sending || (method !== "link" && !contact.trim())}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : method === "link" ? <Copy className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
            {method === "link" ? "Create link" : "Send link"}
          </Button>
          {link ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p className="mb-1 font-medium">Copy it now: it isn&apos;t shown again.</p>
              <code className="break-all">{link}</code>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="divide-y">
          {rows === undefined ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
          {rows?.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No capture links yet.</p> : null}
          {rows?.map((row) => (
            <div key={row._id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <div>
                <p className="font-medium">
                  {row.name ?? row.contact ?? "Shared link"}
                  {row.externalRef ? <span className="text-muted-foreground"> · {row.externalRef}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.method === "link" ? "Copied link" : `${row.method === "sms" ? "SMS" : "WhatsApp"} to ${row.contact}`} · {row.language === "sw" ? "Kiswahili" : "English"} · <ClientDate value={row.createdAt} format="PPp" />
                  {row.deliveryStatus === "failed" ? <span className="text-red-600"> · not delivered: {row.deliveryFailure}</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={row.status === "submitted" ? "default" : "secondary"}>{STATUS_LABEL[row.status]}</Badge>
                {row.verificationId ? (
                  <Link href={`/kyc/${row.verificationId}`} className="text-xs font-medium underline">
                    {row.reference ?? "View check"}
                  </Link>
                ) : null}
                {canSend && (row.status === "pending" || row.status === "opened") ? (
                  <Button size="sm" variant="ghost" onClick={() => void cancel({ clientId, sessionId: row._id }).then(() => toast.success("Link cancelled."))}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
