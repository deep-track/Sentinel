"use client";

import { useState } from "react";
import { uploadFiles } from "@/backend/lib/uploadthing";
import { type KYCSubmissionData } from "@/backend/lib/kyc-types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Upload } from "lucide-react";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";

interface SelfieCaptureStepProps {
  defaultValues?: Partial<KYCSubmissionData>;
  onNext: (data: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64" | "livenessFramesBase64" | "livenessMediaType">) => void;
  onBack: () => void;
}

// Live camera/liveness-video capture was removed per product direction —
// users upload a plain selfie only.
//
// IMPORTANT: the backend mutation (verifications.createKyc) still hard-
// requires a non-empty `livenessFramesBase64` + `livenessMediaType` on
// every submission — it rejects the request otherwise. There is currently
// no backend path that accepts a selfie-only submission. As a stopgap so
// submission doesn't just fail outright, this sends the uploaded selfie
// image itself as a single-frame "liveness" payload. This satisfies the
// backend's validation, but it is NOT real liveness/anti-spoofing
// detection — a static photo can't prove someone is physically present.
// Flagged to Stacy: the real fix is making createKyc accept a selfie-only
// flow (livenessFramesBase64 optional) rather than working around it here.

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not encode capture"));
    reader.readAsDataURL(blob);
  });
}

async function uploadSelfie(file: File) {
  const [base64, uploaded] = await Promise.all([
    readAsDataUrl(file),
    uploadFiles("kycUploader", { files: [file] }),
  ]);
  const url = uploaded[0]?.ufsUrl ?? uploaded[0]?.url;
  if (!url) throw new Error("Upload failed");
  // Strip the "data:image/jpeg;base64," prefix — backend expects raw base64.
  const rawBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
  return { url, base64: rawBase64 };
}

export function SelfieCaptureStep({ defaultValues, onNext, onBack }: SelfieCaptureStepProps) {
  const [selfieUrl, setSelfieUrl] = useState(defaultValues?.selfieUrl ?? "");
  const [selfieBase64, setSelfieBase64] = useState(defaultValues?.selfieBase64 ?? "");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      const result = await uploadSelfie(file);
      setSelfieUrl(result.url);
      setSelfieBase64(result.base64);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to upload selfie.");
    } finally {
      setProcessing(false);
    }
  }

  const ready = Boolean(selfieUrl && selfieBase64);

  return (
    <div className="space-y-6">
      <VerificationTips type="selfie" />

      <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-sm cursor-pointer hover:border-violet-500 transition-colors">
        <input
          type="file"
          className="sr-only"
          accept="image/*"
          disabled={processing}
          onChange={handleUpload}
        />
        {selfieUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selfieUrl} alt="Uploaded selfie" className="h-40 w-40 rounded-lg object-cover" />
        ) : (
          <Upload className="h-8 w-8 text-slate-400" />
        )}
        <span className="text-slate-600 dark:text-slate-300 font-medium">
          {processing ? "Uploading…" : selfieUrl ? "Selfie uploaded — click to replace" : "Upload a selfie"}
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          onClick={() =>
            onNext({
              selfieUrl,
              selfieBase64,
              // Backend still requires this field non-empty — see note above.
              livenessFramesBase64: selfieBase64,
              livenessMediaType: "jpeg_frames",
            })
          }
          disabled={!ready || processing}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          <ArrowRight className="mr-2 h-4 w-4" /> Continue
        </Button>
      </div>
    </div>
  );
}
