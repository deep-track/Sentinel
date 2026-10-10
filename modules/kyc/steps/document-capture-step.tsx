"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/backend/lib/utils";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";
import type { KYCDocumentData, KYCDocumentType } from "@/modules/kyc/types";
import { ImageUploadField } from "@/modules/shared/upload-fields";
import type { PreparedImage } from "@/modules/shared/files";

interface DocumentCaptureStepProps {
  defaultValues?: Partial<KYCDocumentData>;
  onNext: (data: KYCDocumentData) => void;
}

const DOCUMENT_TYPES: { value: KYCDocumentType; label: string; description: string; sides: 1 | 2 }[] = [
  { value: "passport", label: "Passport", description: "Single-page document", sides: 1 },
  { value: "id_card", label: "National ID", description: "Front and back required", sides: 2 },
  { value: "driving_license", label: "Driver's License", description: "Front and back required", sides: 2 },
];

export function DocumentCaptureStep({ defaultValues, onNext }: DocumentCaptureStepProps) {
  const [documentType, setDocumentType] = useState<KYCDocumentType | undefined>(defaultValues?.documentType);
  const [front, setFront] = useState<PreparedImage | null>(
    defaultValues?.documentFrontUrl && defaultValues.documentFrontBase64
      ? { url: defaultValues.documentFrontUrl, base64: defaultValues.documentFrontBase64 }
      : null,
  );
  const [back, setBack] = useState<PreparedImage | null>(
    defaultValues?.documentBackUrl && defaultValues.documentBackBase64
      ? { url: defaultValues.documentBackUrl, base64: defaultValues.documentBackBase64 }
      : null,
  );
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresBackSide = documentType !== undefined && documentType !== "passport";
  const uploading = uploadingFront || uploadingBack;

  function selectDocumentType(next: KYCDocumentType) {
    setDocumentType(next);
    setError(null);
    // A passport has no back side: drop any back image captured for a
    // previously selected two-sided document so it isn't submitted.
    if (next === "passport") setBack(null);
  }

  function handleContinue() {
    if (!documentType) {
      setError("Select a document type.");
      return;
    }
    if (!front) {
      setError("Upload the front of the document.");
      return;
    }
    if (requiresBackSide && !back) {
      setError("Upload the back of the document.");
      return;
    }
    onNext({
      documentType,
      documentFrontUrl: front.url,
      documentFrontBase64: front.base64,
      documentBackUrl: requiresBackSide ? back?.url : undefined,
      documentBackBase64: requiresBackSide ? back?.base64 : undefined,
    });
  }

  return (
    <div className="space-y-6">
      <VerificationTips type="document" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Document type">
        {DOCUMENT_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={documentType === option.value}
            onClick={() => selectDocumentType(option.value)}
            className={cn(
              "rounded-lg border-2 p-4 text-left transition-all",
              documentType === option.value
                ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
            )}
          >
            <p className="font-medium text-sm">{option.label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{option.description}</p>
          </button>
        ))}
      </div>

      {documentType ? (
        <>
          <ImageUploadField
            label={requiresBackSide ? "Step 1 of 2: Front side" : "Photo page"}
            url={front?.url}
            onUploaded={(image) => {
              setFront(image);
              setError(null);
            }}
            onClear={() => setFront(null)}
            onUploadingChange={setUploadingFront}
          />

          {requiresBackSide ? (
            <ImageUploadField
              label="Step 2 of 2: Back side"
              url={back?.url}
              onUploaded={(image) => {
                setBack(image);
                setError(null);
              }}
              onClear={() => setBack(null)}
              onUploadingChange={setUploadingBack}
            />
          ) : null}
        </>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleContinue}
          disabled={!documentType || !front || (requiresBackSide && !back) || uploading}
          className="bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
