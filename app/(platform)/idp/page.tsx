export const dynamic = "force-dynamic";

import { FileScan } from "lucide-react";
import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { DocumentVerificationForm } from "./document-form";

export default async function IdpPage() {
  const { scope } = await requireActiveScope();
  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary text-primary-foreground">
          <FileScan className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Intelligent Document Processing</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Verify identity documents and proof of address for {scope.clientName}: data extraction, AI-generated and
            tampered document detection, and validation.
          </p>
        </div>
      </div>

      <DocumentVerificationForm clientId={scope.clientId} canSubmit={scope.role !== "viewer"} />
    </div>
  );
}
