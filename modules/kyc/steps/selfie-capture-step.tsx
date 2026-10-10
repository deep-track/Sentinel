"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";
import type { KYCSelfieData } from "@/modules/kyc/types";
import { ImageUploadField } from "@/modules/shared/upload-fields";
import type { PreparedImage } from "@/modules/shared/files";

interface SelfieCaptureStepProps {
  defaultValues?: Partial<KYCSelfieData>;
  onNext: (data: KYCSelfieData) => void;
  onBack: () => void;
}

// The dashboard flow collects a still selfie for face matching only. A still
// photo can't prove someone is physically present, so it is NOT sent as
// liveness evidence (verifications.createKyc treats liveness as optional and
// the report shows it as "not collected"). Real liveness runs through the
// Liveness page, which sends the subject a capture link.

export function SelfieCaptureStep({ defaultValues, onNext, onBack }: SelfieCaptureStepProps) {
  const [selfie, setSelfie] = useState<PreparedImage | null>(
    defaultValues?.selfieUrl && defaultValues.selfieBase64
      ? { url: defaultValues.selfieUrl, base64: defaultValues.selfieBase64 }
      : null,
  );
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-6">
      <VerificationTips type="selfie" />

      <ImageUploadField
        label="Selfie"
        description="A clear, front-facing photo of the person on the document."
        url={selfie?.url}
        onUploaded={setSelfie}
        onClear={() => setSelfie(null)}
        onUploadingChange={setUploading}
      />

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          The selfie is compared against the document photo. It is not a liveness check — to confirm the
          person is physically present, send them a link from the Liveness page.
        </p>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={uploading}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          onClick={() => selfie && onNext({ selfieUrl: selfie.url, selfieBase64: selfie.base64 })}
          disabled={!selfie || uploading}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
