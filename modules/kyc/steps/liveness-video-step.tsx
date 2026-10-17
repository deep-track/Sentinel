"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KYCLivenessData } from "@/modules/kyc/types";
import { LivenessVideoRecorder, type RecordedClip } from "@/modules/shared/liveness-video-recorder";

interface LivenessVideoStepProps {
  defaultValues?: Partial<KYCLivenessData>;
  /** `null` = skipped: the person isn't present, so the scan is held for review. */
  onNext: (data: KYCLivenessData | null) => void;
  onBack: () => void;
}

// Records a short clip of the person's face with this device's camera, for
// when they are with the operator. DeepTrack Live checks it for a live person
// (rPPG pulse) and for deepfakes. A remote person gets a link from the
// Liveness page instead.
export function LivenessVideoStep({ defaultValues, onNext, onBack }: LivenessVideoStepProps) {
  const initialClip: RecordedClip | null =
    defaultValues?.livenessVideoBase64 && defaultValues.livenessMediaType
      ? { base64: defaultValues.livenessVideoBase64, mediaType: defaultValues.livenessMediaType }
      : null;
  const [clip, setClip] = useState<RecordedClip | null>(initialClip);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-6">
      <LivenessVideoRecorder initialClip={initialClip} onClipChange={setClip} onBusyChange={setBusy} />

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          The clip is checked by DeepTrack Live to confirm a live person and to catch deepfakes. If the person
          isn&apos;t here, skip this step: the verification is then held for manual review, or send them a link
          from the Liveness page.
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onNext(null)} disabled={busy}>
            Skip, person not present
          </Button>
          <Button
            type="button"
            onClick={() => clip && onNext({ livenessVideoBase64: clip.base64, livenessMediaType: clip.mediaType })}
            disabled={!clip || busy}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
