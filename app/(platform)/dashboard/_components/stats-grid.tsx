// app/(platform)/dashboard/_components/stats-grid.tsx
import { Card } from "@/components/ui/card";

type StatsGridProps = {
  total: number;
  avgCompletionTimeMs: number | null;
  pendingReview: number;
  activeApiKeys: number;
};

function formatMs(ms: number | null) {
  if (!ms) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function StatsGrid({
  total,
  avgCompletionTimeMs,
  pendingReview,
  activeApiKeys,
}: StatsGridProps) {
  const items = [
    { label: "Scans this month", value: total.toLocaleString() },
    { label: "Avg. verification", value: formatMs(avgCompletionTimeMs) },
    { label: "Flagged / review", value: pendingReview.toLocaleString() },
    { label: "Active API keys", value: activeApiKeys.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => (
        <Card key={item.label} className="p-4 bg-card border-border">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {item.label}
          </p>
          <p className="mt-1.5 text-lg font-semibold text-foreground">
            {item.value}
          </p>
        </Card>
      ))}
    </div>
  );
}