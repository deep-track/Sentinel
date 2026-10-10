"use client";

import { useState } from "react";
import type { FinancialDocsData } from "@/backend/lib/kyi-types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DocumentUploadField } from "@/modules/shared/upload-fields";

type DocKey = keyof FinancialDocsData;

interface FinancialDocsStepProps {
  defaultValues?: Partial<FinancialDocsData>;
  onSubmit: (data: FinancialDocsData) => void | Promise<void>;
  /** Saves the current uploads before going back. */
  onBack: (data: Partial<FinancialDocsData>) => void;
  isLoading?: boolean;
  investorType?: string;
  accreditationStatus?: string;
}

type DocSpec = { key: DocKey; label: string; description: string };

const ALWAYS_REQUIRED: DocSpec[] = [
  { key: "bankStatementUrl", label: "Bank Statement", description: "Recent bank statement (last 3 months)" },
  { key: "proofOfAddressUrl", label: "Proof of Address", description: "Utility bill, lease, or official document" },
];

const ACCREDITATION_LETTER: DocSpec = {
  key: "accreditationLetterUrl",
  label: "Accreditation Letter",
  description: "From a broker, investment firm or regulator",
};

const OPTIONAL_DOCS: DocSpec[] = [
  { key: "proofOfNetWorthUrl", label: "Proof of Net Worth", description: "Tax return or financial statement" },
  { key: "sourceOfFundsDocUrl", label: "Source of Funds Document", description: "Supporting documentation" },
  { key: "corporateDocUrl", label: "Corporate Document", description: "Articles of incorporation or registration" },
];

// Documents are uploaded to UploadThing and only their https URLs are kept —
// no base64/data: URLs are stored in Convex.
export function FinancialDocsStep({
  defaultValues,
  onSubmit,
  onBack,
  isLoading,
  investorType,
  accreditationStatus,
}: FinancialDocsStepProps) {
  const [urls, setUrls] = useState<Partial<FinancialDocsData>>({ ...defaultValues });
  const [fileNames, setFileNames] = useState<Partial<Record<DocKey, string>>>({});
  const [uploadingCount, setUploadingCount] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<DocKey, string>>>({});
  const uploading = uploadingCount > 0;

  // kyi.processKyiVerification fails non-retail investors that don't provide
  // an accreditation letter, so require it up front for them.
  const needsAccreditationLetter = Boolean(accreditationStatus) && accreditationStatus !== "retail";
  const required = needsAccreditationLetter ? [...ALWAYS_REQUIRED, ACCREDITATION_LETTER] : ALWAYS_REQUIRED;
  const optional = [
    ...(needsAccreditationLetter ? [] : [ACCREDITATION_LETTER]),
    ...OPTIONAL_DOCS.filter((doc) => doc.key !== "corporateDocUrl" || investorType === "corporate"),
  ];

  function setDoc(key: DocKey, url: string | undefined, fileName?: string) {
    setUrls((prev) => ({ ...prev, [key]: url }));
    setFileNames((prev) => ({ ...prev, [key]: fileName }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit() {
    const missing: Partial<Record<DocKey, string>> = {};
    for (const doc of required) {
      if (!urls[doc.key]) missing[doc.key] = `${doc.label} is required`;
    }
    setErrors(missing);
    const { bankStatementUrl, proofOfAddressUrl } = urls;
    if (Object.keys(missing).length > 0 || !bankStatementUrl || !proofOfAddressUrl) return;
    await onSubmit({
      bankStatementUrl,
      proofOfAddressUrl,
      proofOfNetWorthUrl: urls.proofOfNetWorthUrl || undefined,
      accreditationLetterUrl: urls.accreditationLetterUrl || undefined,
      sourceOfFundsDocUrl: urls.sourceOfFundsDocUrl || undefined,
      corporateDocUrl: investorType === "corporate" ? urls.corporateDocUrl || undefined : undefined,
    });
  }

  const renderDoc = (doc: DocSpec, isRequired: boolean) => (
    <Card key={doc.key} className="p-6">
      <DocumentUploadField
        label={doc.label}
        description={doc.description}
        required={isRequired}
        url={urls[doc.key]}
        fileName={fileNames[doc.key]}
        onUploaded={(url, file) => setDoc(doc.key, url, file.name)}
        onClear={() => setDoc(doc.key, undefined)}
        onUploadingChange={(busy) => setUploadingCount((count) => Math.max(0, count + (busy ? 1 : -1)))}
        disabled={isLoading}
        error={errors[doc.key]}
      />
    </Card>
  );

  return (
    <div className="space-y-8">
      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          Upload financial documents to complete the KYI verification. PDF, JPG or PNG, up to 8 MB each.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">Required Documents</h3>
          <p className="text-sm text-muted-foreground">These documents are mandatory for verification</p>
        </div>
        <div className="space-y-4">{required.map((doc) => renderDoc(doc, true))}</div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">Additional Documents</h3>
          <p className="text-sm text-muted-foreground">Optional documents that support the application</p>
        </div>
        <div className="space-y-4">{optional.map((doc) => renderDoc(doc, false))}</div>
      </div>

      <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        <AlertDescription className="text-green-800 dark:text-green-200">
          All information will be verified using automated checks and reviewed by our compliance team.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={() => onBack(urls)} disabled={isLoading || uploading}>
          Back
        </Button>
        <Button type="button" size="lg" onClick={() => void handleSubmit()} disabled={isLoading || uploading}>
          {uploading ? "Uploading…" : isLoading ? "Submitting..." : "Complete Verification"}
        </Button>
      </div>
    </div>
  );
}
