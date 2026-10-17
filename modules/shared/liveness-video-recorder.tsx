"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, readAsDataUrl, stripDataUrlPrefix } from "@/modules/shared/files";
import {
  LIVENESS_CAMERA_CONSTRAINTS,
  LIVENESS_CLIP_SECONDS,
  LIVENESS_COUNTDOWN_SECONDS,
  LIVENESS_VIDEO_BITS_PER_SECOND,
  MAX_LIVENESS_VIDEO_BYTES,
  cameraErrorMessage,
  pickRecorderFormat,
  type LivenessVideoMediaType,
} from "@/modules/shared/liveness-video";

export type RecordedClip = {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mediaType: LivenessVideoMediaType;
};

interface LivenessVideoRecorderProps {
  initialClip?: RecordedClip | null;
  onClipChange: (clip: RecordedClip | null) => void;
  /** True while counting down, recording or encoding, so callers can lock navigation. */
  onBusyChange?: (busy: boolean) => void;
}

type Phase = "starting" | "ready" | "countdown" | "recording" | "processing" | "recorded" | "error";

// Records a short front-camera clip for a liveness check: framing oval,
// countdown, a fixed-length recording, playback and retake. Used by the KYC
// wizard (operator's device) and the hosted /liveness/<token> page (the
// person's own phone).
export function LivenessVideoRecorder({ initialClip, onClipChange, onBusyChange }: LivenessVideoRecorderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialClip ? `data:video/${initialClip.mediaType};base64,${initialClip.base64}` : null,
  );
  const [phase, setPhase] = useState<Phase>(initialClip ? "recorded" : "starting");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(LIVENESS_COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timersRef = useRef<number[]>([]);

  const busy = phase === "countdown" || phase === "recording" || phase === "processing";
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

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
    if (!initialClip) void startCamera();
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
        onClipChange({ base64, mediaType: format.mediaType });
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
    onClipChange(null);
    setPreviewUrl(null);
    void startCamera();
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
        <li>Use good, even light on the face; avoid a bright window behind.</li>
        <li>Remove hats and sunglasses. Keep the whole face inside the oval.</li>
        <li>Look at the camera and hold still for {LIVENESS_CLIP_SECONDS} seconds.</li>
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
    </div>
  );
}
