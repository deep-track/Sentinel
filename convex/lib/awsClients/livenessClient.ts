import { callInternalService } from "./internalFetch";

export type LivenessRequest = {
 
  frames: string; 
  mediaType: "jpeg_frames" | "mp4";
};

export type LivenessResult = {
  livenessScore: number; // 0-1
  deepfakeFlag: boolean;
  confidence: number; // 0-1
};

export function passesLivenessThreshold(result: LivenessResult): boolean {
  return result.livenessScore >= 0.85 && result.deepfakeFlag === false;
}

export async function checkLiveness(
  req: LivenessRequest,
): Promise<LivenessResult> {
  const raw = await callInternalService<{
    liveness_score: number;
    deepfake_flag: boolean;
    confidence: number;
  }>("/internal/liveness", {
    frames: req.frames,
    media_type: req.mediaType,
  });

  return {
    livenessScore: raw.liveness_score,
    deepfakeFlag: raw.deepfake_flag,
    confidence: raw.confidence,
  };
}