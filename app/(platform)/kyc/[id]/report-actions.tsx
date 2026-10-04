"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

// Uses the browser's native print dialog (user picks "Save as PDF") rather
// than a server-generated PDF — no new dependency, works immediately, and
// the print stylesheet (globals below / print:hidden classes on the page)
// hides the nav and keeps only the report content.
export function DownloadReportButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="print:hidden"
      onClick={() => window.print()}
    >
      <Download className="mr-2 h-4 w-4" /> Download Report (PDF)
    </Button>
  );
}