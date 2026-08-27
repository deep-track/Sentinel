export const dynamic = "force-dynamic";

import { anyApi } from "convex/server";
import { redirect } from "next/navigation";
import ApiKeysTable from "@/app/(platform)/api-keys/api-keys-table";
import CreateApiKeyForm from "./create-api-key-form";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import type { APIKey } from "@/backend/lib/types/api-keys";

export default async function ApiKeysPage() {
  const client = await getAuthenticatedConvexClient();
  if (!client) redirect("/access-pending?reason=authorization-unavailable");
  const access = await client.query(anyApi.dashboard.currentAccess, {});
  const scope = access.memberships[0];
  if (!access.authorized || !scope) redirect("/access-pending");
  let apiKeys: APIKey[] = [];
  try {
    const rows = await client.query(anyApi.apiKeys.listForClient, { clientId: scope.clientId });
    apiKeys = rows.map((row: any) => ({ id: row._id, name: `${row.environment} key`, apiKey: row.prefix, status: row.revoked ? "Suspended" : "Active", createdAt: new Date(row.createdAt) }));
  } catch (error) {
    console.error("[api-keys] Convex query failed", error);
  }
  return <div className="space-y-4 p-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">API keys</h1><p className="text-sm text-muted-foreground">Keys are scoped to {scope.clientName} and only shown by prefix.</p></div><CreateApiKeyForm userId="" companyId={scope.clientId} /></div><ApiKeysTable apiKeys={apiKeys} /></div>;
}