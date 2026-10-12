"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Info, RotateCcw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KYCLivenessData } from "@/modules/kyc/types";
import { formatBytes, readAsDataUrl, stripDataUrlPrefix } from "@/modules/shared/files";
import {
  LIVENESS_CAMERA_CONSTRAINTS,
  LIVENESS_CLIP_SECONDS,
  LIVENESS_COUNTDOWN_SECONDS,
  LIVENESS_VIDEO_BITS_PER_SECOND,
  MAX_LIVENESS_VIDEO_BYTES,
  cameraErrorMessage,
  pickRecorderFormat,
} from "@/modules/shared/liveness-video";

interface LivenessVideoStepProps {
  defaultValues?: Partial<KYCLivenessData>;
  /** `null` = skipped: the person isn't present, so the scan is held for review. */
  onNext: (data: KYCLivenessData | null) => void;
  onBack: () => void;
}

type Phase = "starting" | "ready" | "countdown" | "recording" | "processing" | "recorded" | "error";

// Records a short clip of the person's face with this device's camera, for
// when they are with the operator. DeepTrack Live checks it for a live person
// (rPPG pulse) and for deepfakes. A remote person gets a link from the
// Liveness page instead.
export function LivenessVideoStep({ defaultValues, onNext, onBack }: LivenessVideoStepProps) {
  const initial =
    defaultValues?.livenessVideoBase64 && defaultValues.livenessMediaType
      ? { livenessVideoBase64: defaultValues.livenessVideoBase64, livenessMediaType: defaultValues.livenessMediaType }
      : null;
  const [clip, setClip] = useState<KYCLivenessData | null>(initial);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initial ? `data:video/${initial.livenessMediaType};base64,${initial.livenessVideoBase64}` : null,
  );
  const [phase, setPhase] = useState<Phase>(initial ? "recorded" : "starting");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(LIVENESS_COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearInterval(id);
    timersRef.current = [];
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record video. Use a recent Chrome, Safari or Firefox.");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(LIVENESS_CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase("ready");
    } catch (err) {
      setError(cameraErrorMessage(err));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!initial) void startCamera();
    return () => {
      clearTimers();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopCamera();
    };
    // Runs once on mount; retakes restart the camera explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function record() {
    const stream = streamRef.current;
    const format = pickRecorderFormat((type) => MediaRecorder.isTypeSupported(type));
    if (!stream || !format) {
      setError("This browser can't record MP4 or WebM video.");
      setPhase("error");
      return;
    }

    setCountdown(LIVENESS_COUNTDOWN_SECONDS);
    setPhase("countdown");
    let remaining = LIVENESS_COUNTDOWN_SECONDS;
    const countdownId = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining > 0) return;
      window.clearInterval(countdownId);

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        videoBitsPerSecond: LIVENESS_VIDEO_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        clearTimers();
        stopCamera();
        setPhase("processing");
        const blob = new Blob(chunks, { type: format.mimeType.split(";")[0] });
        if (blob.size > MAX_LIVENESS_VIDEO_BYTES) {
          setError(
            `The clip is ${formatBytes(blob.size)}, over the ${formatBytes(MAX_LIVENESS_VIDEO_BYTES)} limit. Retake it with less movement in the background.`,
          );
          setPhase("error");
          return;
        }
        const base64 = stripDataUrlPrefix(await readAsDataUrl(blob));
        setClip({ livenessVideoBase64: base64, livenessMediaType: format.mediaType });
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("recorded");
      };

      setElapsed(0);
      setPhase("recording");
      recorder.start();
      const startedAt = Date.now();
      const progressId = window.setInterval(() => {
        const seconds = (Date.now() - startedAt) / 1000;
        setElapsed(Math.min(seconds, LIVENESS_CLIP_SECONDS));
        if (seconds >= LIVENESS_CLIP_SECONDS && recorder.state === "recording") recorder.stop();
      }, 100);
      timersRef.current.push(progressId);
    }, 1000);
    timersRef.current.push(countdownId);
  }

  function retake() {
    clearTimers();
    setClip(null);
    setPreviewUrl(null);
    void startCamera();
  }

  const busy = phase === "countdown" || phase === "recording" || phase === "processing";

  return (
    <div className="space-y-6">
      <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
        <li>Use good, even light on the face; avoid a bright window behind the person.</li>
        <li>Remove hats and sunglasses. Keep the whole face inside the oval.</li>
        <li>The person looks at the camera and holds still for {LIVENESS_CLIP_SECONDS} seconds.</li>
      </ul>

      <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-xl bg-slate-900">
        {phase === "recorded" && previewUrl ? (
          <video src={previewUrl} controls playsInline className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        )}

        {(phase === "ready" || phase === "countdown" || phase === "recording") && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[78%] w-[52%] rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
          </div>
        )}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-white">{countdown}</div>
        )}
        {phase === "recording" && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 text-sm font-medium text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            Recording · hold still
          </div>
        )}
        {phase === "recording" && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
            <div className="h-full bg-red-500 transition-[width]" style={{ width: `${(elapsed / LIVENESS_CLIP_SECONDS) * 100}%` }} />
          </div>
        )}
        {(phase === "starting" || phase === "processing") && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            {phase === "starting" ? "Starting camera…" : "Preparing the clip…"}
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">{error}</div>
        )}
      </div>

      <div className="flex justify-center gap-2">
        {phase === "ready" && (
          <Button type="button" onClick={record} className="bg-red-600 text-white hover:bg-red-700">
            <Video className="mr-2 h-4 w-4" /> Record {LIVENESS_CLIP_SECONDS}-second clip
          </Button>
        )}
        {(phase === "recorded" || phase === "error") && (
          <Button type="button" variant="outline" onClick={retake}>
            <RotateCcw className="mr-2 h-4 w-4" /> {phase === "recorded" ? "Retake" : "Try again"}
          </Button>
        )}
      </div>

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
            onClick={() => clip && onNext(clip)}
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
