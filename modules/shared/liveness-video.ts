// Recording settings for the liveness clip. DeepTrack Live reads a pulse from
// small colour changes in the face over time (rPPG), so the clip must be a few
// seconds of steady, well-lit face; resolution matters less than duration.

/** Length of the recorded clip. rPPG needs several heartbeats. */
export const LIVENESS_CLIP_SECONDS = 5;
export const LIVENESS_COUNTDOWN_SECONDS = 3;
/** Keeps a 5 s clip near 560 KB so it fits the 1,000,000-character base64 limit. */
export const LIVENESS_VIDEO_BITS_PER_SECOND = 900_000;
/** 750,000 bytes encode to 1,000,000 base64 characters (MAX_MEDIA_BASE64_CHARS). */
export const MAX_LIVENESS_VIDEO_BYTES = 740_000;

export type LivenessVideoMediaType = "mp4" | "webm";

// MP4 first (Safari, Chrome 126+), then WebM (Firefox, older Chrome).
const CANDIDATES: Array<{ mimeType: string; mediaType: LivenessVideoMediaType }> = [
  { mimeType: "video/mp4;codecs=avc1", mediaType: "mp4" },
  { mimeType: "video/mp4", mediaType: "mp4" },
  { mimeType: "video/webm;codecs=vp8", mediaType: "webm" },
  { mimeType: "video/webm", mediaType: "webm" },
];

/** The first container this browser can record, or null when it can't record video. */
export function pickRecorderFormat(
  isTypeSupported: (mimeType: string) => boolean,
): { mimeType: string; mediaType: LivenessVideoMediaType } | null {
  return CANDIDATES.find((candidate) => isTypeSupported(candidate.mimeType)) ?? null;
}

/** Camera constraints: front camera, modest resolution, no audio. */
export const LIVENESS_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
};

/** A user-facing message for a getUserMedia failure. */
export function cameraErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow camera access for this site in the browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No front camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and try again.";
    default:
      return "The camera could not be started.";
  }
}
