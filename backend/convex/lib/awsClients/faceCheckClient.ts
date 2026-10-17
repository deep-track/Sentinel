import { UpstreamServiceError, invalidResponse } from "./internalFetch";
import {
  DEEPTRACK_LIVE_IMAGE_PATH,
  DEEPTRACK_LIVE_VIDEO_JOB_PATH,
  DEEPTRACK_LIVE_VIDEO_PATH,
  decodeSelfieImage,
  parseDeeptrackLiveImageResponse,
  parseDeeptrackLiveVideoJob,
  videoUploadName,
  type FaceCheckResult,
  type VideoLivenessResult,
} from "../deeptrackLive";

export type FaceCheckRequest = { selfieBase64: string };
export type VideoLivenessRequest = { videoBase64: string; mediaType: "mp4" | "webm" };

// The model service can be slow to warm up, so allow longer than the
// internal services.
const REQUEST_TIMEOUT_MS = 45_000;
// A video job is polled until done, failed, or this budget runs out.
const VIDEO_JOB_BUDGET_MS = 150_000;
const VIDEO_POLL_INTERVAL_MS = 2_000;
const LOGGED_BODY_LIMIT = 300;

function baseUrl(): string {
  const raw = process.env.DEEPTRACK_LIVE_BASE_URL?.trim();
  if (!raw) {
    throw new UpstreamServiceError(
      "upstream_misconfigured",
      "Missing required env var DEEPTRACK_LIVE_BASE_URL: set it in the Convex deployment's environment variables.",
    );
  }
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

function apiKey(): string {
  const key = process.env.DEEPTRACK_LIVE_API_KEY?.trim();
  if (!key) {
    throw new UpstreamServiceError(
      "upstream_misconfigured",
      "Missing required env var DEEPTRACK_LIVE_API_KEY: set it in the Convex deployment's environment variables.",
    );
  }
  return key;
}

// One authenticated request to DeepTrack Live, returning the parsed JSON body.
// Every failure is an UpstreamServiceError, which the risk engine turns into a
// review.
async function requestJson(path: string, init: { method: "GET" | "POST"; body?: FormData }): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: { "X-API-Key": apiKey(), Accept: "application/json" },
      body: init.body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof UpstreamServiceError) throw err;
    const aborted = typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
    throw new UpstreamServiceError(
      aborted ? "upstream_timeout" : "upstream_unavailable",
      aborted ? `DeepTrack Live timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : "DeepTrack Live is unreachable",
    );
  }
  try {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[faceCheck] DeepTrack Live ${path} returned HTTP ${response.status}: ${text.slice(0, LOGGED_BODY_LIMIT)}`);
      throw new UpstreamServiceError("upstream_http_error", `DeepTrack Live returned HTTP ${response.status}`, response.status);
    }
    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeBase64(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(input.trim().replace(/^data:[^;,]+;base64,/i, "").replace(/\s+/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
  } catch {
    return null;
  }
}

// Sends the selfie photo to DeepTrack Live.
export async function checkSelfieFace(req: FaceCheckRequest): Promise<FaceCheckResult> {
  apiKey();
  const image = decodeSelfieImage(req.selfieBase64);
  if (!image) {
    throw new UpstreamServiceError("upstream_invalid_response", "Selfie is not a JPEG, PNG or WebP image.");
  }
  const form = new FormData();
  form.append("file", new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mimeType }), `selfie.${image.extension}`);
  const parsed = parseDeeptrackLiveImageResponse(await requestJson(DEEPTRACK_LIVE_IMAGE_PATH, { method: "POST", body: form }));
  if (!parsed) throw invalidResponse(DEEPTRACK_LIVE_IMAGE_PATH, "missing prediction or confidence_percentage");
  return parsed;
}

// Uploads a short liveness clip, then polls the job until it finishes.
export async function checkLivenessVideo(req: VideoLivenessRequest): Promise<VideoLivenessResult> {
  apiKey();
  const bytes = decodeBase64(req.videoBase64);
  if (!bytes || bytes.length < 1024) {
    throw new UpstreamServiceError("upstream_invalid_response", "Liveness video is empty or not valid base64.");
  }
  const { fileName, mimeType } = videoUploadName(req.mediaType);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const job = await requestJson(DEEPTRACK_LIVE_VIDEO_PATH, { method: "POST", body: form });
  const jobId = typeof job === "object" && job !== null ? (job as Record<string, unknown>).job_id : undefined;
  if (typeof jobId !== "string" && typeof jobId !== "number") {
    throw invalidResponse(DEEPTRACK_LIVE_VIDEO_PATH, "missing job_id");
  }
  const jobPath = `${DEEPTRACK_LIVE_VIDEO_JOB_PATH}${encodeURIComponent(String(jobId))}`;

  const deadline = Date.now() + VIDEO_JOB_BUDGET_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    const status = parseDeeptrackLiveVideoJob(await requestJson(jobPath, { method: "GET" }));
    if (status.state === "done") return status.result;
    if (status.state === "error") {
      throw new UpstreamServiceError("upstream_http_error", "DeepTrack Live could not analyse the liveness video");
    }
    if (status.state === "invalid") throw invalidResponse(jobPath, "unrecognised job status or result");
  }
  throw new UpstreamServiceError("upstream_timeout", `DeepTrack Live video job did not finish within ${VIDEO_JOB_BUDGET_MS / 1000}s`);
}
