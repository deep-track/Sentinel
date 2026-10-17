import catalog from "./trainingVideoCatalog.json";

// Sentinel's training videos (tools/videos). They show Sentinel's screens,
// so they are never put on YouTube or any public host: the files sit in a
// private S3 bucket in DeepTrack's AWS account, and Sentinel hands a signed-in
// viewer a link that works for a short time (trainingVideosNode.play).
// Back Office videos are for DeepTrack staff only.

export type TrainingVideo = {
  id: string;
  title: string;
  chapters: string[];
  course: string;
  order: number;
  internal: boolean;
};

// Generated from the video scripts by tools/videos/catalog.mjs.
export const TRAINING_VIDEOS: TrainingVideo[] = catalog;

export const TRAINING_VOICES = ["default", "kenyan"] as const;
export type TrainingVoice = (typeof TRAINING_VOICES)[number];
export const TRAINING_VOICE_LABELS: Record<TrainingVoice, string> = {
  default: "Standard voice",
  kenyan: "Kenyan voice",
};

export const TRAINING_VIDEO_REGION = "eu-west-1";
export const DEFAULT_TRAINING_BUCKET = "deeptrack-sentinel-training";

// How long a playback link works. Long enough for a paused video; the player
// asks for a fresh one if it stops working.
export const PLAY_LINK_SECONDS = 30 * 60;
// How long an upload link works (tools/videos/publish.mjs).
export const UPLOAD_LINK_SECONDS = 15 * 60;

// Objects live under training/ only (the IAM policy allows nothing else).
export function trainingVideoKey(video: string, voice: TrainingVoice, kind: "mp4" | "vtt"): string {
  return `training/${video}/${voice}.${kind}`;
}

// The browser loads videos from here (the Content-Security-Policy allows it).
export function trainingBucketOrigin(bucket: string = DEFAULT_TRAINING_BUCKET): string {
  return `https://${bucket}.s3.${TRAINING_VIDEO_REGION}.amazonaws.com`;
}

export function trainingVideo(id: string): TrainingVideo | null {
  return TRAINING_VIDEOS.find((video) => video.id === id) ?? null;
}

export function videosForChapter(chapterId: string): TrainingVideo[] {
  return TRAINING_VIDEOS.filter((video) => video.chapters.includes(chapterId));
}

export function isTrainingVoice(value: string): value is TrainingVoice {
  return (TRAINING_VOICES as readonly string[]).includes(value);
}
