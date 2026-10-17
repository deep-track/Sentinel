"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { anyApi } from "convex/server";
import { AlertTriangle, Check, KeyRound, Rocket, TrendingUp, Users } from "lucide-react";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTimeBoundaries } from "@/hooks/use-time-boundaries";
import { cn } from "@/backend/lib/utils";
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Panel,
  PanelHeader,
  Row,
  SentinelCanvas,
  SkeletonBlock,
  StatTile,
  TopBar,
} from "@/components/sentinel/ui";
import { PLAN_LABELS, formatNumber, typeLabel, type Plan } from "@/components/sentinel/format";

type ClientRow = {
  _id: string;
  name: string;
  plan: Plan;
  status: string;
  createdAt: number;
  usage: { weekly: number[]; last14: number; previous14: number; byType: Record<string, number>; churnRisk: boolean };
  keys: Array<{
    _id: string;
    prefix: string;
    environment: "live" | "test";
    revoked: boolean;
    createdAt: number;
    lastUsedAt: number | null;
    flags: string[];
  }>;
  errors: { total: number; byStatus: Record<string, number>; topRoutes: Array<{ route: string; count: number }> };
  onboarding: {
    created: number;
    firstKey: number | null;
    firstTestCall: number | null;
    firstLiveVerification: number | null;
    firstCharge: number | null;
    paying: boolean;
  };
  team: Array<{ userId: string; name: string | null; role: string; isActive: boolean; since: number }>;
};

type Data = { weekStarts: number[]; truncated: boolean; clients: ClientRow[] };

const STAGES: Array<{ key: keyof ClientRow["onboarding"]; label: string }> = [
  { key: "firstKey", label: "API key" },
  { key: "firstTestCall", label: "Test call" },
  { key: "firstLiveVerification", label: "Live verification" },
  { key: "firstCharge", label: "First charge" },
];

const ROLE_LABELS: Record<string, string> = {
  client_admin: "Admin",
  reviewer: "Reviewer",
  compliance_analyst: "Analyst",
  developer: "Developer",
  viewer: "Viewer / Auditor",
};

function weekStartsEndingAt(now: number, count: number): number[] {
  const today = new Date(now);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, index) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (count - 1 - index)).getTime(),
  );
}

function trend(last: number, previous: number) {
  if (previous === 0) return last > 0 ? "new" : "—";
  const pct = Math.round(((last - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 items-end gap-0.5" role="img" aria-label={label}>
      {values.map((value, index) => (
        <div
          key={index}
          className={cn("w-1.5 rounded-sm", index === values.length - 1 ? "bg-sentinel-blue-mid" : "bg-sentinel-blue")}
          style={{ height: `${Math.max(8, (value / max) * 100)}%`, opacity: value === 0 ? 0.25 : 1 }}
          title={`${value}`}
        />
      ))}
    </div>
  );
}

export function ClientHealth() {
  const bounds = useTimeBoundaries();
  const weekStarts = useMemo(() => (bounds ? weekStartsEndingAt(bounds.now, 8) : null), [bounds]);
  const data = useAuthedQuery(
    anyApi.backOfficeClients.clientHealth,
    bounds && weekStarts ? { now: bounds.now, weekStarts } : "skip",
  ) as Data | undefined;
  const [teamClient, setTeamClient] = useState<string | null>(null);

  const atRisk = data?.clients.filter((client) => client.usage.churnRisk) ?? [];
  const errorTotal = data?.clients.reduce((sum, client) => sum + client.errors.total, 0) ?? 0;
  const keysFlagged = data?.clients.reduce((sum, client) => sum + client.keys.filter((key) => key.flags.length > 0).length, 0) ?? 0;
  const live = data?.clients.filter((client) => client.onboarding.firstLiveVerification !== null).length ?? 0;
  const selectedTeam = data?.clients.find((client) => client._id === teamClient) ?? data?.clients[0];

  return (
    <SentinelCanvas className="flex min-h-screen flex-col">
      <TopBar>
        <h1 className="text-[15px] font-semibold">Client health</h1>
        <span className="text-[11px] text-sentinel-subtle">Usage · onboarding · API keys · integration errors · teams</span>
      </TopBar>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {data === undefined || !bounds ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-64" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5">
              <StatTile label="Clients live" value={`${formatNumber(live)} / ${formatNumber(data.clients.length)}`} note="have run a live verification" />
              <StatTile
                label="Usage dropping"
                value={formatNumber(atRisk.length)}
                note="down 50%+ vs the 2 weeks before"
                tone={atRisk.length > 0 ? "red" : undefined}
              />
              <StatTile
                label="Integration errors, 7 days"
                value={formatNumber(errorTotal)}
                note="4xx/5xx returned to client API calls"
                tone={errorTotal > 0 ? "amber" : undefined}
              />
              <StatTile
                label="API keys needing attention"
                value={formatNumber(keysFlagged)}
                note="never used, idle 30+ days, or 180+ days old"
                tone={keysFlagged > 0 ? "amber" : undefined}
              />
            </div>

            <Panel>
              <PanelHeader icon={TrendingUp} title="Usage trend" hint="verifications per week, last 8 weeks (test calls excluded)" />
              <DataTable
                head={["Client", "Plan", "Last 8 weeks", "Last 14 days", "14 days before", "Change", "Mix (14 days)"]}
                empty={data.clients.length === 0 ? <EmptyState>No client accounts yet.</EmptyState> : null}
              >
                {data.clients.map((client) => (
                  <Row key={client._id}>
                    <Cell>
                      <Link href={`/internal-ops/clients?client=${client._id}`} className="hover:text-sentinel-blue-mid">
                        {client.name}
                      </Link>
                      {client.usage.churnRisk ? (
                        <span className="ml-1.5">
                          <Badge tone="red" icon={AlertTriangle}>
                            usage dropping
                          </Badge>
                        </span>
                      ) : null}
                    </Cell>
                    <Cell className="text-sentinel-muted">{PLAN_LABELS[client.plan]}</Cell>
                    <Cell>
                      <Sparkline values={client.usage.weekly} label={`${client.name} weekly verifications`} />
                    </Cell>
                    <Cell>{formatNumber(client.usage.last14)}</Cell>
                    <Cell className="text-sentinel-muted">{formatNumber(client.usage.previous14)}</Cell>
                    <Cell className={client.usage.churnRisk ? "text-sentinel-red-text" : "text-sentinel-muted"}>
                      {trend(client.usage.last14, client.usage.previous14)}
                    </Cell>
                    <Cell className="text-sentinel-muted">
                      {Object.entries(client.usage.byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => `${typeLabel(type)} ${count}`)
                        .join(" · ") || "—"}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              {data.truncated ? <p className="px-3.5 py-2 text-[10px] text-sentinel-subtle">Based on the newest 10,000 verifications.</p> : null}
            </Panel>

            <Panel>
              <PanelHeader icon={Rocket} title="Onboarding" hint="from account created to first charge" />
              <DataTable head={["Client", "Account created", ...STAGES.map((stage) => stage.label), "Paying"]}>
                {data.clients.map((client) => (
                  <Row key={client._id}>
                    <Cell>{client.name}</Cell>
                    <Cell className="text-sentinel-muted">
                      <ClientDate value={client.onboarding.created} format="MMM d, yyyy" />
                    </Cell>
                    {STAGES.map((stage) => {
                      const at = client.onboarding[stage.key] as number | null;
                      return (
                        <Cell key={stage.key} className="text-sentinel-muted">
                          {at ? (
                            <span className="flex items-center gap-1">
                              <Check className="h-3 w-3 text-sentinel-green-text" aria-hidden="true" />
                              <ClientDate value={at} format="MMM d" />
                            </span>
                          ) : (
                            <span className="text-sentinel-faint">not yet</span>
                          )}
                        </Cell>
                      );
                    })}
                    <Cell>
                      <Badge tone={client.onboarding.paying ? "green" : "neutral"}>{client.onboarding.paying ? "Yes" : "No"}</Badge>
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            </Panel>

            <div className="grid gap-3.5 lg:grid-cols-2">
              <Panel>
                <PanelHeader icon={KeyRound} title="API keys" />
                <DataTable
                  head={["Client", "Key", "Env", "Created", "Last used", "Attention"]}
                  empty={data.clients.every((client) => client.keys.length === 0) ? <EmptyState>No API keys yet.</EmptyState> : null}
                >
                  {data.clients.flatMap((client) =>
                    client.keys.map((key) => (
                      <Row key={key._id}>
                        <Cell>{client.name}</Cell>
                        <Cell className="font-mono text-[11px] text-sentinel-muted">{key.prefix}…</Cell>
                        <Cell>
                          <Badge tone={key.environment === "live" ? "blue" : "neutral"}>{key.environment}</Badge>
                        </Cell>
                        <Cell className="text-sentinel-muted">
                          <ClientDate value={key.createdAt} format="MMM d, yyyy" />
                        </Cell>
                        <Cell className="text-sentinel-muted">
                          {key.lastUsedAt ? <ClientDate value={key.lastUsedAt} format="MMM d, HH:mm" /> : "never"}
                        </Cell>
                        <Cell>
                          {key.revoked ? (
                            <Badge tone="neutral">revoked</Badge>
                          ) : key.flags.length ? (
                            key.flags.map((flag) => (
                              <span key={flag} className="mr-1">
                                <Badge tone="amber">{flag}</Badge>
                              </span>
                            ))
                          ) : (
                            <Badge tone="green">ok</Badge>
                          )}
                        </Cell>
                      </Row>
                    )),
                  )}
                </DataTable>
              </Panel>

              <Panel>
                <PanelHeader icon={AlertTriangle} title="Integration errors" hint="last 7 days, per client" />
                <DataTable
                  head={["Client", "Errors", "4xx", "429", "5xx", "Most affected routes"]}
                  empty={errorTotal === 0 ? <EmptyState>No API errors returned to clients in the last 7 days.</EmptyState> : null}
                >
                  {data.clients
                    .filter((client) => client.errors.total > 0)
                    .sort((a, b) => b.errors.total - a.errors.total)
                    .map((client) => (
                      <Row key={client._id}>
                        <Cell>{client.name}</Cell>
                        <Cell>{formatNumber(client.errors.total)}</Cell>
                        <Cell className="text-sentinel-muted">{formatNumber(client.errors.byStatus["4xx"] ?? 0)}</Cell>
                        <Cell className="text-sentinel-muted">{formatNumber(client.errors.byStatus["429"] ?? 0)}</Cell>
                        <Cell className={(client.errors.byStatus["5xx"] ?? 0) > 0 ? "text-sentinel-red-text" : "text-sentinel-muted"}>
                          {formatNumber(client.errors.byStatus["5xx"] ?? 0)}
                        </Cell>
                        <Cell className="text-sentinel-muted">
                          {client.errors.topRoutes.map((route) => `${route.route} (${route.count})`).join(" · ")}
                        </Cell>
                      </Row>
                    ))}
                </DataTable>
              </Panel>
            </div>

            <Panel>
              <PanelHeader
                icon={Users}
                title="Client teams"
                action={
                  <select
                    className="rounded border border-sentinel-line bg-sentinel-raised px-2 py-1 text-[12px] text-sentinel-text"
                    value={selectedTeam?._id ?? ""}
                    onChange={(event) => setTeamClient(event.target.value)}
                    aria-label="Client"
                  >
                    {data.clients.map((client) => (
                      <option key={client._id} value={client._id}>
                        {client.name} ({client.team.filter((member) => member.isActive).length})
                      </option>
                    ))}
                  </select>
                }
              />
              <DataTable
                head={["Member", "Role", "Status", "Since"]}
                empty={!selectedTeam || selectedTeam.team.length === 0 ? <EmptyState>No team members recorded for this client.</EmptyState> : null}
              >
                {selectedTeam?.team.map((member) => (
                  <Row key={member.userId}>
                    <Cell>
                      {member.name ?? <span className="font-mono text-[11px] text-sentinel-muted">{member.userId}</span>}
                      {member.name ? (
                        <span className="block font-mono text-[10px] text-sentinel-subtle">{member.userId}</span>
                      ) : null}
                    </Cell>
                    <Cell>{ROLE_LABELS[member.role] ?? member.role}</Cell>
                    <Cell>
                      <Badge tone={member.isActive ? "green" : "neutral"}>{member.isActive ? "active" : "inactive"}</Badge>
                    </Cell>
                    <Cell className="text-sentinel-muted">
                      <ClientDate value={member.since} format="MMM d, yyyy" />
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              <p className="px-3.5 py-2 text-[10px] text-sentinel-subtle">
                Members appear by name once they have signed in; until then only their sign-in ID is known.
              </p>
            </Panel>
          </>
        )}
      </div>
    </SentinelCanvas>
  );
}
