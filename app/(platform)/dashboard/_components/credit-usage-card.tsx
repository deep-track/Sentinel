// app/(platform)/dashboard/_components/credit-usage-card.tsx
import { Card } from "@/components/ui/card";

async function getBilling() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/client/billing`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export async function CreditUsageCard() {
  const billing = await getBilling();
  if (!billing) return null;

  const { scanCredits, scanCreditsUsed, percentUsed } = billing;

  return (
    <Card className="p-5 bg-card border-border">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Credits this cycle
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">
              {scanCreditsUsed.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              / {scanCredits.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(percentUsed, 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {percentUsed}% used · alert triggers at 80%
      </p>
    </Card>
  );
}