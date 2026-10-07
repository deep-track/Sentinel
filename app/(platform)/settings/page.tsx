import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

type CurrentUser = {
  userId: string;
  email: string | null;
  name: string | null;
  isInternalAdmin: boolean;
  organizations: Array<{
    clientId: string;
    name: string;
    plan: string;
    status: string;
    role: string;
  }>;
};

async function getCurrentUser(): Promise<{ user: CurrentUser | null; error?: string }> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { user: null, error: "Authentication is not configured." };
    const user: CurrentUser | null = await client.query(anyApi.settings.getCurrentUser, {});
    return { user };
  } catch (error) {
    console.error("[settings] Convex query failed", error);
    return { user: null, error: "Settings are temporarily unavailable." };
  }
}

export default async function SettingsPage() {
  const { user, error } = await getCurrentUser();

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Your profile and organization details
        </p>
      </div>

      {!user ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            {error ?? "Settings are temporarily unavailable."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-6 bg-card border-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Profile
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{user.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{user.email ?? "—"}</span>
              </div>
              {user.isInternalAdmin ? (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Account type</span>
                  <Badge variant="outline">Internal admin</Badge>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-6 bg-card border-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Organizations
            </p>
            {user.organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You&apos;re not currently a member of any organization.
              </p>
            ) : (
              <div className="space-y-3">
                {user.organizations.map((org) => (
                  <div
                    key={org.clientId}
                    className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{org.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{org.role.replace("_", " ")}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p className="capitalize">{org.plan} plan</p>
                      <p className="capitalize">{org.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}