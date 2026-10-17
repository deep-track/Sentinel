export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { TeamView } from "./team-view";

export default async function TeamPage() {
  const { scope } = await requireActiveScope();
  return <TeamView clientId={scope.clientId} isAdmin={scope.role === "client_admin"} />;
}
