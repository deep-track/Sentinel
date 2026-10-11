export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { PortalView } from "./portal-view";

// Client portal: Sentinel-branded overview for the organization selected in
// the sidebar switcher. Data is live from portal.overview.
export default async function ClientPortalPage() {
  const { scope } = await requireActiveScope();
  return <PortalView clientId={scope.clientId} clientName={scope.clientName} />;
}
