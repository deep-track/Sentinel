"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadReportSpec, type ReportSpec } from "./report-spec";

// "Download report (PDF)" for a report described as data (report-spec.ts).
export function ReportPdfButton({ spec, label = "Download report (PDF)" }: { spec: ReportSpec; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      className="print:hidden"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadReportSpec(spec);
        } catch {
          toast.error("The PDF couldn't be created. Printing instead.");
          window.print();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}
