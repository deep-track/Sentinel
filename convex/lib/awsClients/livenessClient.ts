import { callInternalService } from "./internalFetch";

export type LivenessRequest = {
  // Base64 frames (JPEG) or short .mp4, up to 10s — per Section 8.3.
  frames: string; // base64
  mediaType: "jpeg_frames" | "mp4";
};

export type LivenessResult = {
  livenessScore: number; // 0-1
  deepfakeFlag: boolean;
  confidence: number; // 0-1
};

// Pass threshold per Section 5.1 / 8.3 note: liveness_score >= 0.85 AND
// deepfake_flag == false. Defined here, next to the client, so the
// threshold can't drift out of sync with what this service actually
// returns — riskEngine.ts imports this rather than redefining it.
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