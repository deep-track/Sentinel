import { UpstreamServiceError, invalidResponse } from "./internalFetch";
import {
  DEEPTRACK_LIVE_DEFAULT_BASE_URL,
  DEEPTRACK_LIVE_IMAGE_PATH,
  decodeSelfieImage,
  parseDeeptrackLiveImageResponse,
  type FaceCheckResult,
} from "../deeptrackLive";

export type FaceCheckRequest = { selfieBase64: string };

// Render free/starter instances can cold-start, so allow longer than the
// internal services.
const TIMEOUT_MS = 45_000;
const LOGGED_BODY_LIMIT = 300;

function baseUrl(): string {
  const raw = process.env.DEEPTRACK_LIVE_BASE_URL?.trim() || DEEPTRACK_LIVE_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamServiceError("upstream_misconfigured", "DEEPTRACK_LIVE_BASE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new UpstreamServiceError("upstream_misconfigured", "DEEPTRACK_LIVE_BASE_URL must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

// Sends the selfie photo to DeepTrack Live. Every failure is an
// UpstreamServiceError, which the risk engine turns into a review.
export async function checkSelfieFace(req: FaceCheckRequest): Promise<FaceCheckResult> {
  const apiKey = process.env.DEEPTRACK_LIVE_API_KEY?.trim();
  if (!apiKey) {
    throw new UpstreamServiceError(
      "upstream_misconfigured",
      "Missing required env var DEEPTRACK_LIVE_API_KEY: set it in the Convex deployment's environment variables.",
    );
  }
  const image = decodeSelfieImage(req.selfieBase64);
  if (!image) {
    throw new UpstreamServiceError("upstream_invalid_response", "Selfie is not a JPEG, PNG or WebP image.");
  }

  const form = new FormData();
  form.append("file", new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mimeType }), `selfie.${image.extension}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${DEEPTRACK_LIVE_IMAGE_PATH}`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const aborted = typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
    throw new UpstreamServiceError(
      aborted ? "upstream_timeout" : "upstream_unavailable",
      aborted ? `DeepTrack Live timed out after ${TIMEOUT_MS / 1000}s` : "DeepTrack Live is unreachable",
    );
  }
  try {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[faceCheck] DeepTrack Live returned HTTP ${response.status}: ${text.slice(0, LOGGED_BODY_LIMIT)}`);
      throw new UpstreamServiceError("upstream_http_error", `DeepTrack Live returned HTTP ${response.status}`, response.status);
    }
    const parsed = parseDeeptrackLiveImageResponse(await response.json().catch(() => null));
    if (!parsed) throw invalidResponse(DEEPTRACK_LIVE_IMAGE_PATH, "missing prediction or confidence_percentage");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}
