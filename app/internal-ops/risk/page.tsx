import { RiskDashboard } from "./risk-dashboard";

// Back Office risk dashboard. Access is enforced by app/internal-ops/layout.tsx
// and again in Convex (backOfficeCompliance.riskDashboard).
export default function RiskPage() {
  return <RiskDashboard />;
}
