import { Card } from "@/components/ui/card";

type BreakdownItem = {
  type: string;
  count: number;
  percentage: number;
};

function labelForType(type: string) {
  switch (type) {
    case "idp":
      return "KYC / Identity";
    case "kyb":
      return "KYB";
    case "aml":
      return "AML";
    case "liveness":
      return "Liveness";
    default:
      return type.toUpperCase();
  }
}

export function VerificationBreakdown({ data }: { data: BreakdownItem[] }) {
  return (
    <Card className="p-5 bg-card border-border">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Verification mix</h2>
          <p className="mt-1 text-xs text-muted-foreground">Last 30 days</p>
        </div>
        <span className="text-xs text-muted-foreground">KYC / KYI activity</span>
      </div>
      {data.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No verification activity in this period.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {data.map((item) => (
            <div key={item.type}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{labelForType(item.type)}</span>
                <span className="text-muted-foreground">
                  {item.count.toLocaleString()} ({item.percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(Math.max(item.percentage, 0), 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
