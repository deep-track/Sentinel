import { OpsOverview } from "./ops-overview";

// Sentinel Ops landing screen: cross-client overview (admin.opsOverview).
// Access is enforced by app/internal-ops/layout.tsx and again in Convex.
export default function OpsOverviewPage() {
  return <OpsOverview />;
}
