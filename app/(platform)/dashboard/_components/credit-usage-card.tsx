import Link from "next/link";
import { AlertTriangle, CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";

export type CreditSummary = {
  balance: number;
  clientName: string;
};

// creditLedger.getBalanceForClient only exposes a running balance
// (allocations minus deductions) — there is no public notion of a billing
// cycle, cap or usage percentage, so none is shown.
export function CreditUsageCard({ credits, error }: { credits: CreditSummary | null; error?: string }) {
  if (!credits) {
    return (
      <Card className="p-5 border-dashed">
        <p className="text-sm text-muted-foreground">{error ?? "Credit balance is unavailable."}</p>
      </Card>
    );
  }

  const exhausted = credits.balance <= 0;

  return (
    <Card className="p-5 bg-card border-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Credit balance · {credits.clientName}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">
              {credits.balance.toLocaleString("en-US")}
            </span>
            <span className="text-sm text-muted-foreground">credits</span>
          </div>
        </div>
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
      </div>
      {exhausted ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          No credits remaining — new verifications will be rejected.{" "}
          <Link href="/billing" className="underline underline-offset-2">
            Billing &amp; Credits
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
