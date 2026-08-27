import { Shield } from "lucide-react";
import { anyApi } from "convex/server";
import { redirect } from "next/navigation";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { AMLScreeningForm } from "./aml-screening-form";

export default async function AMLCheckPage() {
  const client = await getAuthenticatedConvexClient();
  if (!client) redirect("/access-pending?reason=authorization-unavailable");
  const access = await client.query(anyApi.dashboard.currentAccess, {});
  const scope = access.memberships[0];
  if (!access.authorized || !scope) redirect("/access-pending");
  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary text-primary-foreground">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AML Screening & Sanctions Check</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Screen individuals and companies against global sanctions and watchlists.
          </p>
        </div>
      </div>

      <AMLScreeningForm clientId={scope.clientId} />
    </div>
  );
}
