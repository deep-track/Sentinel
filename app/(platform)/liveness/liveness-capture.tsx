"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, RotateCcw, Circle, Square } from "lucide-react";

const MAX_DURATION_MS = 10_000;

type CaptureState = "idle" | "requesting" | "ready" | "recording" | "preview";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function submitLivenessSession(blob: Blob): Promise<never> {
  throw new Error(
    "Liveness submission endpoint isn't built yet — capture works, but there's nowhere to send this clip."
  );
}

export function LivenessCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<CaptureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [stopStream]);

  async function startCamera() {
    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("ready");
    } catch {
      setError(
        "Couldn't access your camera. Check browser permissions and try again."
      );
      setState("idle");
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: "video/webm",
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setRecordedBlob(blob);
      stopStream();
      setState("preview");
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setElapsedMs(0);

    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_DURATION_MS) {
        recorder.stop();
      } else {
        timeoutRef.current = setTimeout(tick, 100);
      }
    };
    timeoutRef.current = setTimeout(tick, 100);
  }

  function stopRecording() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    mediaRecorderRef.current?.stop();
  }

  function retake() {
    setRecordedBlob(null);
    setSubmitError(null);
    setState("idle");
  }

  useEffect(() => {
    if (state === "preview" && recordedBlob && previewRef.current) {
      previewRef.current.src = URL.createObjectURL(recordedBlob);
    }
  }, [state, recordedBlob]);

  async function handleSubmit() {
    if (!recordedBlob) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitLivenessSession(recordedBlob);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submission failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 bg-card border-border max-w-xl">
      <div className="aspect-video rounded-lg overflow-hidden bg-black flex items-center justify-center">
        {state === "preview" && recordedBlob ? (
          <video ref={previewRef} controls className="w-full h-full" />
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            className={`w-full h-full object-cover ${
              state === "idle" || state === "requesting" ? "hidden" : ""
            }`}
          />
        )}
        {(state === "idle" || state === "requesting") && (
          <Camera className="h-10 w-10 text-white/40" />
        )}
      </div>

      {state === "recording" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Recording... {(elapsedMs / 1000).toFixed(1)}s / 10s
        </p>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {submitError && (
        <p className="mt-3 text-sm text-destructive">{submitError}</p>
      )}

      <div className="mt-4 flex gap-2">
        {state === "idle" && (
          <Button onClick={startCamera}>
            <Camera className="h-4 w-4 mr-2" />
            Enable camera
          </Button>
        )}

        {state === "requesting" && <Button disabled>Requesting access...</Button>}

        {state === "ready" && (
          <Button onClick={startRecording}>
            <Circle className="h-4 w-4 mr-2 fill-current" />
            Start recording
          </Button>
        )}

        {state === "recording" && (
          <Button variant="destructive" onClick={stopRecording}>
            <Square className="h-4 w-4 mr-2 fill-current" />
            Stop
          </Button>
        )}

        {state === "preview" && (
          <>
            <Button variant="outline" onClick={retake}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retake
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit for verification"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}