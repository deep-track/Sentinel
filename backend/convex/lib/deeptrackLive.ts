// DeepTrack Live: Deeptrack's rPPG-based face authenticity model
// (deep-track/FaceDetectionSystem, client SDK in deep-track/deeptrack).
// Selfie photos go to POST /v1/image/predict as multipart "file" with an
// X-API-Key header. Liveness videos go to POST /v1/video/predict/video, which
// returns a job id polled at GET /v1/video/jobs/{id}. No imports, so tests can
// transpile and evaluate this file.

export const DEEPTRACK_LIVE_DEFAULT_BASE_URL = "https://facedetectionsystem-staging.onrender.com";
export const DEEPTRACK_LIVE_IMAGE_PATH = "/v1/image/predict";
export const DEEPTRACK_LIVE_VIDEO_PATH = "/v1/video/predict/video";
export const DEEPTRACK_LIVE_VIDEO_JOB_PATH = "/v1/video/jobs/";

// A liveness video only counts as clean when a face is visible in most frames
// and at least one rPPG segment (a stretch long enough to read a pulse) ran.
export const MIN_FACE_PCT_FOR_CLEAR = 80;
// A "fake" video verdict only rejects when there was enough face to judge.
export const MIN_FACE_PCT_FOR_REJECT = 50;

// A "fake" prediction at or above this confidence rejects outright. Below
// it, or for any uncertain/low-quality result, a human reviews the selfie.
export const FAKE_REJECT_CONFIDENCE_PCT = 90;
// A "real" prediction must be at least this confident to count as clean.
export const REAL_PASS_CONFIDENCE_PCT = 70;

export type FaceCheckResult = {
  provider: "deeptrack_live";
  prediction: "real" | "fake" | "uncertain";
  confidencePct: number;
  fakeProbability: number | null;
  warning: string | null;
};

export type FaceCheckDecision = "clear" | "review" | "reject";

// Returns null for any shape we don't recognise; callers treat that as an
// invalid upstream response (review, never pass).
export function parseDeeptrackLiveImageResponse(raw: unknown): FaceCheckResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const label = typeof body.prediction === "string" ? body.prediction.trim().toLowerCase() : "";
  const prediction = label === "real" || label === "fake" || label === "uncertain" ? label : null;
  const confidence = body.confidence_percentage;
  if (!prediction || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    return null;
  }
  const scores = body.raw_scores;
  const fake = typeof scores === "object" && scores !== null ? (scores as Record<string, unknown>).Fake : undefined;
  const fakeProbability = typeof fake === "number" && Number.isFinite(fake) && fake >= 0 && fake <= 1 ? fake : null;
  const warning = typeof body.warning === "string" && body.warning.trim() ? body.warning.trim().slice(0, 200) : null;
  return { provider: "deeptrack_live", prediction, confidencePct: confidence, fakeProbability, warning };
}

export function faceCheckDecision(result: FaceCheckResult): FaceCheckDecision {
  if (result.prediction === "fake" && result.confidencePct >= FAKE_REJECT_CONFIDENCE_PCT) return "reject";
  if (result.prediction === "real" && result.confidencePct >= REAL_PASS_CONFIDENCE_PCT && !result.warning) return "clear";
  return "review";
}

// Accepts raw base64 or a data: URL. Returns null for anything that isn't a
// JPEG, PNG or WebP image.
export function decodeSelfieImage(input: string): { bytes: Uint8Array; mimeType: string; extension: string } | null {
  const base64 = input.trim().replace(/^data:[^;,]+;base64,/i, "").replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { bytes, mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP") {
    return { bytes, mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

export type VideoLivenessResult = {
  provider: "deeptrack_live";
  prediction: "real" | "fake" | "uncertain";
  confidencePct: number;
  fakeProbability: number | null;
  facePct: number;
  totalFrames: number | null;
  segments: number;
};

export type VideoJobStatus =
  | { state: "pending" }
  | { state: "done"; result: VideoLivenessResult }
  | { state: "error" }
  | { state: "invalid" };

function finiteInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

// The video job's `result` (label, confidence, fake_prob, face_pct,
// total_frames, n_segments, as read by the deeptrack SDK). Null when the
// shape is not recognised.
export function parseDeeptrackLiveVideoResult(raw: unknown): VideoLivenessResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim().toLowerCase() : "";
  const prediction = label === "real" || label === "fake" || label === "uncertain" ? label : null;
  const confidencePct = finiteInRange(body.confidence, 0, 100);
  const facePct = finiteInRange(body.face_pct, 0, 100);
  const segments = finiteInRange(body.n_segments, 0, Number.MAX_SAFE_INTEGER);
  if (!prediction || confidencePct === null || facePct === null || segments === null) return null;
  return {
    provider: "deeptrack_live",
    prediction,
    confidencePct,
    fakeProbability: finiteInRange(body.fake_prob, 0, 1),
    facePct,
    totalFrames: finiteInRange(body.total_frames, 0, Number.MAX_SAFE_INTEGER),
    segments: Math.floor(segments),
  };
}

// GET /v1/video/jobs/{id}: { status: "done", result } | { status: "error" } |
// any other status while the job runs.
export function parseDeeptrackLiveVideoJob(raw: unknown): VideoJobStatus {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { state: "invalid" };
  const body = raw as Record<string, unknown>;
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!status) return { state: "invalid" };
  if (status === "error" || status === "failed") return { state: "error" };
  if (status !== "done") return { state: "pending" };
  const result = parseDeeptrackLiveVideoResult(body.result);
  return result ? { state: "done", result } : { state: "invalid" };
}

export function videoLivenessDecision(result: VideoLivenessResult): FaceCheckDecision {
  if (
    result.prediction === "fake" &&
    result.confidencePct >= FAKE_REJECT_CONFIDENCE_PCT &&
    result.facePct >= MIN_FACE_PCT_FOR_REJECT
  ) {
    return "reject";
  }
  if (
    result.prediction === "real" &&
    result.confidencePct >= REAL_PASS_CONFIDENCE_PCT &&
    result.facePct >= MIN_FACE_PCT_FOR_CLEAR &&
    result.segments >= 1
  ) {
    return "clear";
  }
  return "review";
}

// MediaRecorder gives MP4 (Safari, recent Chrome) or WebM (Firefox, older
// Chrome). DeepTrack Live accepts .mp4/.mov/.avi/.mkv; WebM is a subset of
// Matroska, so a WebM recording is uploaded as .mkv.
export function videoUploadName(mediaType: "mp4" | "webm"): { fileName: string; mimeType: string } {
  return mediaType === "mp4"
    ? { fileName: "liveness.mp4", mimeType: "video/mp4" }
    : { fileName: "liveness.mkv", mimeType: "video/x-matroska" };
}
