"use client";

import { useState } from "react";
import { uploadFiles } from "@/backend/lib/uploadthing";
import { type KYCSubmissionData } from "@/backend/lib/kyc-types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Upload } from "lucide-react";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";

interface SelfieCaptureStepProps {
  defaultValues?: Partial<KYCSubmissionData>;
  onNext: (data: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64">) => void;
  onBack: () => void;
}

async function uploadAndEncode(file: File) {
  const [base64, uploaded] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }),
    uploadFiles("kycUploader", { files: [file] }),
  ]);

  const url = uploaded[0]?.ufsUrl ?? uploaded[0]?.url;
  if (!url) throw new Error("Upload failed");
  return { url, base64 };
}

export function SelfieCaptureStep({ defaultValues, onNext, onBack }: SelfieCaptureStepProps) {
  const [selfieUrl, setSelfieUrl] = useState(defaultValues?.selfieUrl ?? "");
  const [selfieBase64, setSelfieBase64] = useState(defaultValues?.selfieBase64 ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <VerificationTips type="selfie" />
      
      <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm cursor-pointer hover:border-violet-500">
        <input
          type="file"
          className="sr-only"
          accept="image/*"
          disabled={uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setError(null);
            setUploading(true);
            try {
              const result = await uploadAndEncode(file);
              setSelfieUrl(result.url);
              setSelfieBase64(result.base64);
            } catch {
              setError("Failed to upload selfie");
            } finally {
              setUploading(false);
            }
          }}
        />
        <Upload className="h-4 w-4" />
        {uploading ? "Uploading selfie..." : selfieUrl ? "Replace selfie" : "Upload selfie"}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {selfieUrl && <p className="text-sm text-emerald-600">Selfie uploaded successfully.</p>}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          onClick={() => onNext({ selfieUrl, selfieBase64 })}
          disabled={!selfieUrl || !selfieBase64}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
