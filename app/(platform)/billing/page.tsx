import { Card } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

async function getBilling() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/client/billing`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function BillingPage() {
  const billing = await getBilling();

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
            No active session found, so billing details can&apos;t be loaded
            right now. Sign in to view your plan and credit usage.
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
              Credits this cycle
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">
                {billing.scanCreditsUsed.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">
                / {billing.scanCredits.toLocaleString()} credits
              </span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(billing.percentUsed, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {billing.percentUsed}% used
            </p>
          </Card>

          <Card className="p-6 bg-card border-border">
            <p className="text-sm font-medium text-foreground">
              Billing history
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Transaction history isn&apos;t available yet — this will show
              once the credit ledger is wired up on the backend.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}