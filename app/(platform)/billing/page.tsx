import { Card } from "@/components/ui/card";
import { CreditCard } from "lucide-react";
import { anyApi } from "convex/server";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

// NOTE: creditLedger.getBalanceForClient (the one real, public credit
// function) only returns a running balance — allocations minus
// deductions. There's no public concept of a monthly "cycle," a plan-
// level cap, or a usage percentage, and no public query for transaction
// history (only an internal one). Shown honestly below rather than
// inventing cycle/percentage numbers that aren't backed by anything.

type BillingData = {
  plan: string;
  balance: number;
  multiClient: boolean;
};

async function getBilling(): Promise<{ billing: BillingData | null; error?: string }> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { billing: null, error: "Authentication is not configured." };

    const [access, user] = await Promise.all([
      client.query(anyApi.dashboard.currentAccess, {}),
      client.query(anyApi.settings.getCurrentUser, {}),
    ]);
    if (!access.authorized || access.memberships.length === 0) {
      return { billing: null, error: "No organization membership found for this account." };
    }

    const balances = await Promise.all(
      access.memberships.map((m: { clientId: string }) =>
        client.query(anyApi.creditLedger.getBalanceForClient, { clientId: m.clientId }),
      ),
    );
    const balance = balances.reduce((sum: number, b: number) => sum + b, 0);
    const plan = user?.organizations?.[0]?.plan ?? "—";

    return { billing: { plan, balance, multiClient: access.memberships.length > 1 } };
  } catch (error) {
    console.error("[billing] Convex query failed", error);
    return { billing: null, error: "Billing details are temporarily unavailable." };
  }
}

export default async function BillingPage() {
  const { billing, error } = await getBilling();

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Billing &amp; Credits
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your plan and monitor credit usage
        </p>
      </div>

      {!billing ? (
        <Card className="p-6 border-dashed">
          <p className="text-sm text-muted-foreground">
            {error ?? "Billing details can't be loaded right now."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-6 bg-card border-border">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Current plan
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground capitalize">
                  {billing.plan}
                </p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-card border-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Credit balance{billing.multiClient ? " (all orgs)" : ""}
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">
                {billing.balance.toLocaleString("en-US")}
              </span>
              <span className="text-sm text-muted-foreground">credits</span>
            </div>
          </Card>

          <Card className="p-6 bg-card border-border">
            <p className="text-sm font-medium text-foreground">
              Billing history
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Transaction history isn&apos;t available yet — the backend has
              ledger data internally, but no public query exposes it to this
              page yet.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}