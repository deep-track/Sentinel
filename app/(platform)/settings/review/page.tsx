export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { ReviewSettings } from "./review-settings";

export default async function ReviewSettingsPage() {
  const { scope } = await requireActiveScope();
  return <ReviewSettings clientId={scope.clientId} />;
}
