import { asRecord, callInternalService, readBoolean, readNumber } from "./internalFetch";

export type LivenessRequest = {
  frames: string;
  mediaType: "jpeg_frames" | "mp4";
};

export type LivenessResult = {
  livenessScore: number; // 0-1
  deepfakeFlag: boolean;
  confidence: number; // 0-1
};

const PATH = "/internal/liveness";

export function passesLivenessThreshold(result: LivenessResult): boolean {
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

export async function checkLiveness(
  req: LivenessRequest,
): Promise<LivenessResult> {
  const raw = await callInternalService(PATH, {
    frames: req.frames,
    media_type: req.mediaType,
  });
  return parseLivenessResponse(raw);
}
