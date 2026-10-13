// DeepTrack Live: Deeptrack's rPPG-based face authenticity model
// (deep-track/FaceDetectionSystem, client SDK in deep-track/deeptrack).
// Selfie photos go to POST /v1/image/predict as multipart "file" with an
// X-API-Key header. No imports, so tests can transpile and evaluate this file.

// There is no default service URL: DEEPTRACK_LIVE_BASE_URL must be set in
// the Convex deployment (the old Render staging service is no longer used).
export const DEEPTRACK_LIVE_IMAGE_PATH = "/v1/image/predict";

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
