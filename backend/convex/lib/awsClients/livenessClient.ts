import { asRecord, callInternalService, readBoolean, readNumber } from "./internalFetch";
import { checkLivenessVideo } from "./faceCheckClient";
import { videoLivenessDecision, type FaceCheckDecision, type VideoLivenessResult } from "../deeptrackLive";

export type LivenessMediaType = "jpeg_frames" | "mp4" | "webm";

export type LivenessRequest = {
  frames: string;
  mediaType: LivenessMediaType;
};

export type LivenessResult = {
  livenessScore: number; // 0-1
  deepfakeFlag: boolean;
  confidence: number; // 0-1
  // Set for video liveness, which DeepTrack Live scores: its own decision
  // replaces the score threshold, and its raw result is kept for reviewers.
  decision?: FaceCheckDecision;
  deeptrackLive?: VideoLivenessResult;
};

const PATH = "/internal/liveness";

export function passesLivenessThreshold(result: LivenessResult): boolean {
  if (result.decision !== undefined) return result.decision === "clear";
  return (
    Number.isFinite(result.livenessScore) &&
    result.livenessScore >= 0.85 &&
    result.deepfakeFlag === false
  );
}

export function parseLivenessResponse(raw: unknown): LivenessResult {
  const body = asRecord(raw, PATH);
  return {
    livenessScore: readNumber(body, "liveness_score", PATH, { min: 0, max: 1 }),
    deepfakeFlag: readBoolean(body, "deepfake_flag", PATH),
    confidence: readNumber(body, "confidence", PATH, { min: 0, max: 1 }),
  };
}

// Maps a DeepTrack Live video verdict onto the shared liveness shape.
export function livenessFromVideo(video: VideoLivenessResult): LivenessResult {
  const realProbability =
    video.fakeProbability !== null
      ? 1 - video.fakeProbability
      : video.prediction === "real"
        ? video.confidencePct / 100
        : 0;
  return {
    livenessScore: realProbability,
    deepfakeFlag: video.prediction === "fake",
    confidence: video.confidencePct / 100,
    decision: videoLivenessDecision(video),
    deeptrackLive: video,
  };
}

// Video (mp4/webm) goes to DeepTrack Live; JPEG frame bundles still go to the
// internal liveness service.
export async function checkLiveness(
  req: LivenessRequest,
): Promise<LivenessResult> {
  if (req.mediaType === "mp4" || req.mediaType === "webm") {
    return livenessFromVideo(await checkLivenessVideo({ videoBase64: req.frames, mediaType: req.mediaType }));
  }
  const raw = await callInternalService(PATH, {
    frames: req.frames,
    media_type: req.mediaType,
  });
  return parseLivenessResponse(raw);
}
