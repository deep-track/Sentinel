export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { OrganizationProfile } from "./organization-profile";

export default async function OrganizationSettingsPage() {
  const { scope } = await requireActiveScope();
  return <OrganizationProfile clientId={scope.clientId} />;
}
