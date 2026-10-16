export const dynamic = "force-dynamic";

import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { CaptureLinkPanel } from "./capture-link-panel";

export default async function CapturePage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Capture links</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Send a customer a secure link by SMS or WhatsApp, or copy it into your own chat. They photograph their ID and take a selfie on their phone, in
          English or Swahili, and the result appears under KYC. The check is billed when they submit. Links work for 72 hours, once.
        </p>
      </div>
      <CaptureLinkPanel clientId={scope.clientId} canSend={scope.role !== "viewer"} />
    </div>
  );
}
