import { ClientHealth } from "./client-health";

// Back Office client health. Access is enforced by app/internal-ops/layout.tsx
// and again in Convex (backOfficeClients.clientHealth).
export default function ClientHealthPage() {
  return <ClientHealth />;
}
