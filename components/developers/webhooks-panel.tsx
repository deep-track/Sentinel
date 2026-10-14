"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Pause, Pencil, Play, Plus, RotateCw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { validateWebhookUrl } from "@/modules/shared/webhook-url";

// The organization's webhook endpoints (up to 5), each with its own events,
// products, environment, secret and custom headers; test events; secret
// rotation without a gap; automatic pausing after repeated failures; and
// the delivery log with details and resend.

type Option = { value: string; label: string; detail?: string };
type Endpoint = {
  _id: string;
  url: string;
  description: string | null;
  events: string[];
  products: string[] | null;
  environment: "live" | "test" | "all";
  headers: Array<{ name: string; preview: string }>;
  status: "active" | "paused";
  pausedAt: number | null;
  pausedReason: string | null;
  consecutiveFailures: number;
  rotation: { createdAt: number; activatesAt: number } | null;
  held: number;
  failed: number;
  health: { sent: number; successRate: number | null; avgLatencyMs: number | null };
  createdAt: number;
};
type Delivery = {
  _id: string;
  endpointId: string | null;
  status: "pending" | "delivered" | "retrying" | "failed" | "paused";
  event: string | null;
  reference: string | null;
  test: boolean;
  attemptCount: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastResponseStatus: number | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  createdAt: number;
};
type Data = {
  legacyPending: boolean;
  endpoints: Endpoint[];
  deliveries: Delivery[];
  options: { events: Option[]; products: Option[]; maxEndpoints: number; pauseAfter: number };
};

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";
const ENVIRONMENTS = [
  { value: "all", label: "Live and test" },
  { value: "live", label: "Live only" },
  { value: "test", label: "Test keys only" },
] as const;
const STATUS_STYLE: Record<Delivery["status"], string> = {
  delivered: "bg-emerald-600 text-white hover:bg-emerald-600",
  pending: "",
  retrying: "border-amber-300 text-amber-700",
  failed: "border-red-300 text-red-700",
  paused: "border-slate-300 text-slate-600",
};
const ERROR_LABELS: Record<string, string> = {
  timeout: "No response within 10 seconds",
  network_error: "Couldn't connect (DNS, TLS or refused)",
  blocked_url: "Not a public HTTPS address",
  redirect_not_followed: "Redirected (Sentinel doesn't follow redirects)",
  endpoint_paused: "Held: endpoint paused",
  endpoint_removed: "Endpoint removed",
};

function errorLabel(error: string | null, status: number | null) {
  if (!error) return status ? `HTTP ${status}` : "—";
  if (error.startsWith("http_")) return `HTTP ${error.slice(5)}`;
  return ERROR_LABELS[error] ?? error;
}

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function WebhooksPanel({ clientId, canManage, canResend }: { clientId: string; canManage: boolean; canResend: boolean }) {
  const [status, setStatus] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");
  const [search, setSearch] = useState("");
  const data = useAuthedQuery(anyApi.webhooks.getForClient, {
    clientId,
    ...(status ? { status } : {}),
    ...(endpointFilter ? { endpointId: endpointFilter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }) as Data | null | undefined;
  const ensure = useMutation(anyApi.webhooks.ensureEndpoints);
  const [editing, setEditing] = useState<Endpoint | "new" | null>(null);
  const [secret, setSecret] = useState<{ value: string; note: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  // Move a webhook set up before endpoints existed into one.
  const legacy = data?.legacyPending === true;
  useEffect(() => {
    if (legacy) void ensure({ clientId }).catch(() => undefined);
  }, [legacy, clientId, ensure]);

  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  if (data === null) return null;
  const labels = Object.fromEntries(data.options.events.map((event) => [event.value, event.label]));

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Webhook endpoints</h2>
            <p className="text-sm text-muted-foreground">Results are POSTed to each endpoint as they happen, signed with its secret. Up to {data.options.maxEndpoints} endpoints.</p>
          </div>
          {canManage ? (
            <Button type="button" onClick={() => setEditing("new")} disabled={data.endpoints.length >= data.options.maxEndpoints}>
              <Plus className="mr-1.5 h-4 w-4" /> Add endpoint
            </Button>
          ) : null}
        </div>
        {!canManage ? <p className="border-b px-5 py-2 text-xs text-muted-foreground">Only Admins and Developers can change webhooks.</p> : null}
        {data.endpoints.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{legacy ? "Loading your webhook…" : "No endpoints yet. Add one to receive results as soon as checks complete."}</p>
        ) : (
          <div className="divide-y">
            {data.endpoints.map((endpoint) => (
              <EndpointRow
                key={endpoint._id}
                endpoint={endpoint}
                labels={labels}
                products={data.options.products}
                canManage={canManage}
                canResend={canResend}
                onEdit={() => setEditing(endpoint)}
                onSecret={setSecret}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-base font-semibold">Deliveries</h2>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Search by scan ID" className={`${inputClass} w-48`} placeholder="Scan ID" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select aria-label="Status" className={`${inputClass} w-36`} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {(["delivered", "retrying", "failed", "paused", "pending"] as const).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {data.endpoints.length > 1 ? (
              <select aria-label="Endpoint" className={`${inputClass} w-48`} value={endpointFilter} onChange={(event) => setEndpointFilter(event.target.value)}>
                <option value="">All endpoints</option>
                {data.endpoints.map((endpoint) => (
                  <option key={endpoint._id} value={endpoint._id}>
                    {endpoint.description ?? host(endpoint.url)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        {data.deliveries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No deliveries{status || search ? " match" : " yet"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Scan</th>
                  <th className="p-3">Event</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Result</th>
                  <th className="p-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((delivery) => (
                  <tr key={delivery._id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setDetail(delivery._id)}>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      <ClientDate value={delivery.createdAt} format="PPp" />
                    </td>
                    <td className="p-3 font-mono text-xs">{delivery.reference ?? "—"}</td>
                    <td className="p-3 text-xs">{delivery.test ? "Test event" : labels[delivery.event ?? ""] ?? delivery.event ?? "—"}</td>
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
                    <td className="p-3 text-xs text-muted-foreground">
                      {delivery.status === "delivered" ? `HTTP ${delivery.lastResponseStatus ?? 200}` : errorLabel(delivery.lastError, delivery.lastResponseStatus)} · {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{delivery.lastLatencyMs !== null ? `${delivery.lastLatencyMs} ms` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <IntegrationHelp />

      {editing !== null ? (
        <EndpointDialog
          clientId={clientId}
          endpoint={editing === "new" ? null : editing}
          options={data.options}
          onClose={() => setEditing(null)}
          onSecret={(value) => setSecret({ value, note: "Store it in your secrets manager. Every delivery is signed with it." })}
        />
      ) : null}
      {secret ? <SecretDialog secret={secret.value} note={secret.note} onClose={() => setSecret(null)} /> : null}
      {detail ? <DeliveryDialog deliveryId={detail} canResend={canResend} labels={labels} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

function EndpointRow({
  endpoint,
  labels,
  products,
  canManage,
  canResend,
  onEdit,
  onSecret,
}: {
  endpoint: Endpoint;
  labels: Record<string, string>;
  products: Option[];
  canManage: boolean;
  canResend: boolean;
  onEdit: () => void;
  onSecret: (secret: { value: string; note: string }) => void;
}) {
  const sendTest = useMutation(anyApi.webhooks.sendTest);
  const pause = useMutation(anyApi.webhooks.pauseEndpoint);
  const resume = useMutation(anyApi.webhooks.resumeEndpoint);
  const rotate = useMutation(anyApi.webhooks.rotateSecret);
  const activate = useMutation(anyApi.webhooks.activateSecret);
  const remove = useMutation(anyApi.webhooks.deleteEndpoint);
  const resendFailed = useMutation(anyApi.webhooks.resendFailed);
  const [busy, setBusy] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const test = useAuthedQuery(anyApi.webhooks.getDelivery, testId ? { deliveryId: testId } : "skip") as (Delivery & { attempts: unknown[] }) | null | undefined;

  async function run<T>(action: () => Promise<T>, done?: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      if (done) toast.success(done);
      return result;
    } catch (error) {
      toast.error(getErrorMessage(error, "That didn't work."));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const productLabel = endpoint.products === null ? "All products" : endpoint.products.map((value) => products.find((item) => item.value === value)?.label ?? value).join(", ");
  const testDone = test && (test.status === "delivered" || test.status === "failed");

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {endpoint.description ?? host(endpoint.url)}
            {endpoint.status === "paused" ? (
              <Badge variant="outline" className="ml-2 border-red-300 text-red-700">
                Paused
              </Badge>
            ) : (
              <Badge className="ml-2 bg-emerald-600 text-white hover:bg-emerald-600">Active</Badge>
            )}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">{endpoint.url}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {endpoint.events.map((event) => labels[event] ?? event).join(", ")} · {productLabel} · {ENVIRONMENTS.find((item) => item.value === endpoint.environment)?.label}
            {endpoint.headers.length ? ` · ${endpoint.headers.length} custom header${endpoint.headers.length === 1 ? "" : "s"}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last 7 days:{" "}
            {endpoint.health.sent === 0 ? "nothing sent" : `${endpoint.health.successRate}% delivered of ${endpoint.health.sent}${endpoint.health.avgLatencyMs !== null ? ` · ${endpoint.health.avgLatencyMs} ms average` : ""}`}
            {endpoint.consecutiveFailures > 0 ? <span className="text-amber-700"> · {endpoint.consecutiveFailures} failed in a row</span> : null}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => setTestId(((await run(() => sendTest({ endpointId: endpoint._id }))) as { deliveryId: string } | undefined)?.deliveryId ?? null)}>
              <Send className="mr-1 h-3.5 w-3.5" /> Send test
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onEdit} aria-label="Edit endpoint">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Create a new signing secret? Deliveries keep using the current one, and also carry a signature with the new one in X-Sentinel-Signature-V2-Next, until you activate it or 24 hours pass.")) return;
                const result = (await run(() => rotate({ endpointId: endpoint._id }))) as { secret: string; activatesAt: number } | undefined;
                if (result) onSecret({ value: result.secret, note: `Deploy it to your receiver, then click Activate (or it activates automatically on ${new Date(result.activatesAt).toLocaleString()}).` });
              }}
            >
              <KeyRound className="mr-1 h-3.5 w-3.5" /> Rotate secret
            </Button>
            {endpoint.status === "active" ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => pause({ endpointId: endpoint._id }), "Endpoint paused")}>
                <Pause className="mr-1 h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={busy} onClick={async () => {
                const result = (await run(() => resume({ endpointId: endpoint._id }))) as { requeued: number } | undefined;
                if (result) toast.success(result.requeued ? `Resumed; sending ${result.requeued} held deliveries` : "Resumed");
              }}>
                <Play className="mr-1 h-3.5 w-3.5" /> Resume
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label="Delete endpoint"
              onClick={() => {
                if (window.confirm(`Delete the endpoint ${endpoint.url}? It stops receiving deliveries right away.`)) void run(() => remove({ endpointId: endpoint._id }), "Endpoint deleted");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {endpoint.status === "paused" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {endpoint.pausedReason ?? "Paused."} {endpoint.held ? `${endpoint.held} deliveries are held and will be sent when you resume.` : ""}
        </p>
      ) : null}
      {endpoint.rotation ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <span>
            New secret waiting: deliveries also carry X-Sentinel-Signature-V2-Next. It activates on <ClientDate value={endpoint.rotation.activatesAt} format="PPp" />.
          </span>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => activate({ endpointId: endpoint._id }), "New secret active")}>
              Activate now
            </Button>
          ) : null}
        </div>
      ) : null}
      {testId ? (
        <p className="rounded-md border px-3 py-2 text-sm">
          {!testDone ? (
            <>
              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> Sending a test event…
            </>
          ) : test.status === "delivered" ? (
            <span className="text-emerald-700">Test delivered: HTTP {test.lastResponseStatus} in {test.lastLatencyMs} ms.</span>
          ) : (
            <span className="text-red-700">Test failed: {errorLabel(test.lastError, test.lastResponseStatus)}{test.lastLatencyMs !== null ? ` after ${test.lastLatencyMs} ms` : ""}.</span>
          )}
        </p>
      ) : null}
      {canResend && endpoint.failed > 0 && endpoint.status === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            const result = (await run(() => resendFailed({ endpointId: endpoint._id }))) as { requeued: number } | undefined;
            if (result) toast.success(`Resending ${result.requeued} failed deliveries`);
          }}
        >
          <RotateCw className="mr-1 h-3.5 w-3.5" /> Resend {endpoint.failed} failed
        </Button>
      ) : null}
    </div>
  );
}

function EndpointDialog({
  clientId,
  endpoint,
  options,
  onClose,
  onSecret,
}: {
  clientId: string;
  endpoint: Endpoint | null;
  options: Data["options"];
  onClose: () => void;
  onSecret: (secret: string) => void;
}) {
  const create = useMutation(anyApi.webhooks.createEndpoint);
  const update = useMutation(anyApi.webhooks.updateEndpoint);
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [events, setEvents] = useState<string[]>(endpoint?.events ?? ["sentinel.scan.complete", "sentinel.monitoring.alert"]);
  const [allProducts, setAllProducts] = useState(endpoint ? endpoint.products === null : true);
  const [products, setProducts] = useState<string[]>(endpoint?.products ?? options.products.map((product) => product.value));
  const [environment, setEnvironment] = useState<Endpoint["environment"]>(endpoint?.environment ?? "all");
  const [headers, setHeaders] = useState<Array<{ name: string; value: string; keep: boolean }>>(
    (endpoint?.headers ?? []).map((header) => ({ name: header.name, value: "", keep: true })),
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateWebhookUrl(url);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const headerArg = headers
      .filter((header) => header.name.trim())
      .map((header) => (header.keep && !header.value ? { name: header.name } : { name: header.name, value: header.value }));
    try {
      if (endpoint) {
        await update({
          endpointId: endpoint._id,
          url: url.trim(),
          description,
          events,
          products: allProducts ? null : products,
          environment,
          headers: headerArg,
        });
        toast.success("Endpoint saved");
        onClose();
      } else {
        const result = (await create({ clientId, url: url.trim(), description, events, products: allProducts ? null : products, environment, headers: headerArg })) as { secret: string };
        onClose();
        onSecret(result.secret);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "The endpoint couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((item) => item !== value));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{endpoint ? "Edit endpoint" : "Add endpoint"}</DialogTitle>
            <DialogDescription>A public HTTPS URL that accepts POST requests and returns a 2xx status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="endpoint-url" className="text-sm font-medium">
              URL
            </label>
            <input id="endpoint-url" className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.yourbank.co.ke/sentinel/webhook" required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="endpoint-description" className="text-sm font-medium">
              Description
            </label>
            <input id="endpoint-description" className={inputClass} maxLength={100} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Production onboarding service" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Events</p>
            {options.events.map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={events.includes(option.value)} onChange={(event) => setEvents(toggle(events, option.value, event.target.checked))} />
                <span>
                  {option.label} <span className="font-mono text-xs text-muted-foreground">{option.value}</span>
                  {option.detail ? <span className="block text-xs text-muted-foreground">{option.detail}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Products</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={allProducts} onChange={(event) => setAllProducts(event.target.checked)} />
              Every product
            </label>
            {!allProducts ? (
              <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
                {options.products.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={products.includes(option.value)} onChange={(event) => setProducts(toggle(products, option.value, event.target.checked))} />
                    {option.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="endpoint-environment" className="text-sm font-medium">
              Checks from
            </label>
            <select id="endpoint-environment" className={inputClass} value={environment} onChange={(event) => setEnvironment(event.target.value as Endpoint["environment"])}>
              {ENVIRONMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Test keys return sandbox results; send them to a staging endpoint with &quot;Test keys only&quot;.</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Custom headers</p>
            <p className="text-xs text-muted-foreground">Sent with every delivery, e.g. an Authorization token your gateway expects. Values are hidden after saving.</p>
            {headers.map((header, index) => (
              <div key={index} className="flex gap-2">
                <input aria-label="Header name" className={`${inputClass} w-2/5`} value={header.name} placeholder="Authorization" onChange={(event) => setHeaders(headers.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
                <input
                  aria-label="Header value"
                  className={inputClass}
                  value={header.value}
                  placeholder={header.keep ? "(unchanged)" : "Bearer …"}
                  onChange={(event) => setHeaders(headers.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))}
                />
                <Button type="button" variant="outline" size="icon" aria-label="Remove header" onClick={() => setHeaders(headers.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {headers.length < 5 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setHeaders([...headers, { name: "", value: "", keep: false }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add header
              </Button>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || events.length === 0}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {endpoint ? "Save" : "Add endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ secret, note, onClose }: { secret: string; note: string; onClose: () => void }) {
  const [stored, setStored] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !stored) {
          toast.warning("Copy the secret and confirm you've stored it before closing. It can't be shown again.");
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
          <DialogDescription>This is the only time it&apos;s shown. {note}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <code className="flex-1 break-all text-xs">{secret}</code>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Copy secret"
            onClick={() =>
              navigator.clipboard.writeText(secret).then(
                () => toast.success("Copied"),
                () => toast.error("Couldn't copy. Select the secret and copy it."),
              )
            }
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={stored} onChange={(event) => setStored(event.target.checked)} />
          I&apos;ve stored this secret.
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

type DeliveryDetail = Delivery & { endpointUrl: string | null; payload: unknown; attempts: Array<{ at: number; statusCode?: number; error?: string; latencyMs?: number }> };

function DeliveryDialog({ deliveryId, canResend, labels, onClose }: { deliveryId: string; canResend: boolean; labels: Record<string, string>; onClose: () => void }) {
  const delivery = useAuthedQuery(anyApi.webhooks.getDelivery, { deliveryId }) as DeliveryDetail | null | undefined;
  const resend = useMutation(anyApi.webhooks.resendWebhook);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delivery</DialogTitle>
          <DialogDescription>{delivery ? `${delivery.test ? "Test event" : labels[delivery.event ?? ""] ?? delivery.event} to ${delivery.endpointUrl ?? "a removed endpoint"}` : "Loading…"}</DialogDescription>
        </DialogHeader>
        {delivery ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Status: <span className="font-medium">{delivery.status}</span>
              </span>
              <span>Scan: <span className="font-mono text-xs">{delivery.reference ?? "—"}</span></span>
              <span>
                Created <ClientDate value={delivery.createdAt} format="PPpp" />
              </span>
            </div>
            <div>
              <p className="font-medium">Attempts</p>
              {delivery.attempts.length === 0 ? (
                <p className="text-muted-foreground">{delivery.status === "paused" ? "Not sent: the endpoint is paused." : "No attempts recorded."}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {delivery.attempts.map((attempt, index) => (
                    <li key={index} className="flex flex-wrap gap-x-3 text-muted-foreground">
                      <ClientDate value={attempt.at} format="PPpp" />
                      <span className={attempt.statusCode && attempt.statusCode < 300 ? "text-emerald-700" : "text-red-700"}>{errorLabel(attempt.error ?? null, attempt.statusCode ?? null)}</span>
                      {attempt.latencyMs !== undefined ? <span>{attempt.latencyMs} ms</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Sentinel records the status code and timing only; it never reads your endpoint&apos;s response body.</p>
            </div>
            <div>
              <p className="font-medium">Payload</p>
              <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(delivery.payload, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
        <DialogFooter>
          {canResend && delivery && delivery.status !== "pending" && delivery.status !== "retrying" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                resend({ deliveryId }).then(
                  () => toast.success("Resending"),
                  (error) => toast.error(getErrorMessage(error, "Couldn't resend.")),
                )
              }
            >
              <RotateCw className="mr-1.5 h-4 w-4" /> Resend
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SNIPPETS: Record<string, string> = {
  "Node.js": `import crypto from "node:crypto";

// Express: app.post("/sentinel/webhook", express.raw({ type: "application/json" }), handler)
function verify(rawBody, headers, secret) {
  const timestamp = headers["x-sentinel-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay window
  const expected = crypto.createHmac("sha256", secret).update(\`\${timestamp}.\${rawBody}\`).digest("hex");
  const given = [headers["x-sentinel-signature-v2"], headers["x-sentinel-signature-v2-next"]].filter(Boolean);
  return given.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}`,
  Python: `import hashlib, hmac, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    timestamp = headers["X-Sentinel-Timestamp"]
    if abs(time.time() - int(timestamp)) > 300:  # replay window
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    given = [headers.get("X-Sentinel-Signature-V2"), headers.get("X-Sentinel-Signature-V2-Next")]
    return any(sig and hmac.compare_digest(sig, expected) for sig in given)`,
  PHP: `<?php
function verify(string $rawBody, array $headers, string $secret): bool {
    $timestamp = $headers['X-Sentinel-Timestamp'];
    if (abs(time() - (int) $timestamp) > 300) return false; // replay window
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    foreach (['X-Sentinel-Signature-V2', 'X-Sentinel-Signature-V2-Next'] as $name) {
        if (!empty($headers[$name]) && hash_equals($expected, $headers[$name])) return true;
    }
    return false;
}`,
  Java: `import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import java.util.HexFormat;

static boolean verify(String rawBody, String timestamp, String sigV2, String sigNext, String secret) throws Exception {
    if (Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(timestamp)) > 300) return false;
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"));
    byte[] expected = HexFormat.of().formatHex(mac.doFinal((timestamp + "." + rawBody).getBytes("UTF-8"))).getBytes();
    for (String sig : new String[] { sigV2, sigNext }) {
        if (sig != null && MessageDigest.isEqual(expected, sig.getBytes())) return true;
    }
    return false;
}`,
};

function IntegrationHelp() {
  const [language, setLanguage] = useState("Node.js");
  return (
    <Card className="p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold">Verifying deliveries</h2>
        <p className="text-sm text-muted-foreground">
          Each delivery carries <span className="font-mono text-xs">X-Sentinel-Timestamp</span> and <span className="font-mono text-xs">X-Sentinel-Signature-V2</span>, an HMAC-SHA256 of{" "}
          <span className="font-mono text-xs">timestamp.body</span> with your secret. While a new secret is waiting, <span className="font-mono text-xs">X-Sentinel-Signature-V2-Next</span> is signed with it, so accept
          either. Verify against the raw body, reject timestamps older than 5 minutes, and return a 2xx within 10 seconds (do slow work afterwards).
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.keys(SNIPPETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setLanguage(name)}
            aria-pressed={language === name}
            className={`rounded-md px-3 py-1 text-sm ${language === name ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{SNIPPETS[language]}</pre>
      <p className="text-xs text-muted-foreground">
        Sentinel sends from Convex cloud, which has no fixed IP addresses, so allowlist by signature rather than by IP. Failed deliveries are retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours; an endpoint failing 20 attempts in a row is paused and your Admins and Developers are alerted.
      </p>
    </Card>
  );
}
