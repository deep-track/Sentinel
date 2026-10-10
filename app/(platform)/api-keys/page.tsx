export const dynamic = "force-dynamic";

import { anyApi } from "convex/server";
import ApiKeysTable from "@/app/(platform)/api-keys/api-keys-table";
import CreateApiKeyForm from "./create-api-key-form";
import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import type { APIKey } from "@/backend/lib/types/api-keys";

type ApiKeyRow = {
  _id: string;
  prefix: string;
  environment: "live" | "test";
  revoked: boolean;
  createdAt: number;
  lastUsedAt?: number;
};

export default async function ApiKeysPage() {
  const { client, scope } = await requireActiveScope();
  const canManage = scope.role === "client_admin";

  let apiKeys: APIKey[] = [];
  let error: string | null = null;
  try {
    const rows: ApiKeyRow[] = await client.query(anyApi.apiKeys.listForClient, { clientId: scope.clientId });
    apiKeys = rows.map((row) => ({
      id: row._id,
      name: `${row.environment === "test" ? "Test" : "Live"} key`,
      apiKey: row.prefix,
      status: row.revoked ? "Suspended" : "Active",
      createdAt: new Date(row.createdAt),
    }));
  } catch (cause) {
    console.error("[api-keys] Convex query failed", cause);
    error = "API keys couldn't be loaded right now. Try again in a moment.";
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Keys are scoped to {scope.clientName} and only shown by prefix.
          </p>
        </div>
        {canManage ? <CreateApiKeyForm clientId={scope.clientId} /> : null}
      </div>
      {!canManage ? (
        <p className="text-sm text-muted-foreground">
          Only organization admins can create or revoke API keys.
        </p>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      ) : (
        <ApiKeysTable apiKeys={apiKeys} />
      )}
    </div>
  );
}
