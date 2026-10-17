export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { requestIp } from "@/app/(platform)/_lib/request-ip";
import { SecuritySettings } from "./security-settings";
import { SsoSection } from "./sso-section";

function authDomain(): string | null {
  const domain = process.env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return domain || null;
}

export default async function SecuritySettingsPage() {
  const [{ scope }, currentIp] = await Promise.all([requireActiveScope(), requestIp()]);
  return (
    <>
      {scope.role === "client_admin" ? <SsoSection clientId={scope.clientId} authDomain={authDomain()} /> : null}
      <SecuritySettings clientId={scope.clientId} currentIp={currentIp} />
    </>
  );
}
