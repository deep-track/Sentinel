"use client";

import { useEffect, useRef, useState } from "react";
import { uploadFiles } from "@/backend/lib/uploadthing";
import { type KYCSubmissionData } from "@/backend/lib/kyc-types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Camera, Square, Upload, Video } from "lucide-react";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";

interface SelfieCaptureStepProps {
  defaultValues?: Partial<KYCSubmissionData>;
  onNext: (data: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64" | "livenessFramesBase64" | "livenessMediaType">) => void;
  onBack: () => void;
}

const RECORDING_MS = 5000;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not encode capture"));
    reader.readAsDataURL(blob);
  });
}

async function uploadCapture(file: File) {
  const [base64, uploaded] = await Promise.all([
    readAsDataUrl(file),
    uploadFiles("kycUploader", { files: [file] }),
  ]);
  const url = uploaded[0]?.ufsUrl ?? uploaded[0]?.url;
  if (!url) throw new Error("Upload failed");
  return { url, base64 };
}

export function SelfieCaptureStep({ defaultValues, onNext, onBack }: SelfieCaptureStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState(defaultValues?.selfieUrl ?? "");
  const [selfieBase64, setSelfieBase64] = useState(defaultValues?.selfieBase64 ?? "");
  const [livenessFramesBase64, setLivenessFramesBase64] = useState(defaultValues?.livenessFramesBase64 ?? "");
  const [livenessMediaType, setLivenessMediaType] = useState<"jpeg_frames" | "mp4">(defaultValues?.livenessMediaType ?? "mp4");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function startCamera() {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Camera permission is required for liveness capture.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function captureStill(): Promise<File> {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) throw new Error("Camera preview is not ready.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("Could not capture selfie frame.");
    return new File([blob], `liveness-selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function finishRecording(blob: Blob) {
    try {
      if (blob.size > MAX_VIDEO_BYTES) throw new Error("The liveness video is too large. Please record again.");
      const videoFile = new File([blob], `liveness-${Date.now()}.mp4`, { type: "video/mp4" });
      const selfieFile = await captureStill();
      setProcessing(true);
      const [video, selfie] = await Promise.all([uploadCapture(videoFile), uploadCapture(selfieFile)]);
      setPreviewUrl(URL.createObjectURL(blob));
      setSelfieUrl(selfie.url);
      setSelfieBase64(selfie.base64);
      setLivenessFramesBase64(video.base64);
      setLivenessMediaType("mp4");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not process liveness capture.");
    } finally {
      setProcessing(false);
      stopCamera();
    }
  }

  async function startRecording() {
    setError(null);
    if (!streamRef.current) await startCamera();
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = "video/mp4";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      setError("This browser cannot record the required MP4 liveness format. Please use a supported mobile or desktop browser.");
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onerror = () => setError("The camera recording failed. Please try again.");
    recorder.onstop = () => { void finishRecording(new Blob(chunksRef.current, { type: mimeType })); };
    recorder.start(250);
    setRecording(true);
    timerRef.current = window.setTimeout(stopRecording, RECORDING_MS);
  }

  function stopRecording() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }

  const ready = Boolean(selfieUrl && selfieBase64 && livenessFramesBase64 && livenessMediaType);

  return (
    <div className="space-y-6">
      <VerificationTips type="selfie" />
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4 text-violet-600" /> Record a 5-second liveness video</div>
        <video ref={videoRef} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" />
        <p className="mt-3 text-xs text-slate-500">Keep your face centered, look at the camera, and follow any instructions shown by the verification service.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void startCamera()} disabled={recording || processing}><Camera className="mr-2 h-4 w-4" />Enable camera</Button>
          {!recording ? <Button type="button" onClick={() => void startRecording()} disabled={processing}><Video className="mr-2 h-4 w-4" />Start capture</Button> : <Button type="button" variant="destructive" onClick={stopRecording}><Square className="mr-2 h-4 w-4" />Stop capture</Button>}
        </div>
        {processing && <p className="mt-3 text-sm text-violet-600">Uploading liveness capture securely…</p>}
        {previewUrl && <p className="mt-3 text-sm text-emerald-600">Liveness video captured successfully.</p>}
      </div>
      <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm cursor-pointer hover:border-violet-500">
        <input type="file" className="sr-only" accept="image/*" disabled={processing || recording} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setError(null); setProcessing(true); try { const result = await uploadCapture(file); setSelfieUrl(result.url); setSelfieBase64(result.base64); } catch { setError("Failed to upload selfie"); } finally { setProcessing(false); } }} />
        <Upload className="h-4 w-4" /> Use an uploaded selfie instead
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button type="button" onClick={() => onNext({ selfieUrl, selfieBase64, livenessFramesBase64, livenessMediaType })} disabled={!ready || processing || recording} className="bg-violet-600 hover:bg-violet-700 text-white"><ArrowRight className="mr-2 h-4 w-4" /> Continue</Button>
      </div>
    </div>
  );
}
