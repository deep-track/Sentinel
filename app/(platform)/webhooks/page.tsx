import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WebhookCreateDialog } from "./webhook-create-dialog";

type Webhook = {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastStatus: string | null;
  lastDelivery: string | null;
  failCount: number;
  createdAt: string;
};

async function getWebhooks(): Promise<Webhook[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/client/webhooks`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export default async function WebhooksPage() {
  const webhooks = await getWebhooks();

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Webhooks
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Get notified when a verification completes
          </p>
        </div>
        <WebhookCreateDialog />
      </div>

      {webhooks.length === 0 ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            No webhooks configured yet. Add one to receive real-time
            verification results at your own endpoint.
          </p>
        </Card>
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last delivery</TableHead>
                <TableHead>Failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((wh) => (
                <TableRow key={wh.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {wh.url}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {wh.events.map((event) => (
                        <Badge key={event} variant="outline">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={wh.isActive ? "success" : "secondary"}>
                      {wh.isActive ? "active" : "disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {wh.lastDelivery
                      ? new Date(wh.lastDelivery).toLocaleString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {wh.failCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}