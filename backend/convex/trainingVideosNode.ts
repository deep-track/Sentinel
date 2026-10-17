"use node";

import { ConvexError, v } from "convex/values";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  DEFAULT_TRAINING_BUCKET,
  PLAY_LINK_SECONDS,
  TRAINING_VIDEO_REGION,
  UPLOAD_LINK_SECONDS,
  trainingVideo,
  trainingVideoKey,
} from "./lib/trainingVideos";

// Training videos in the private S3 bucket (lib/trainingVideos.ts). Sentinel
// checks who is asking, then hands out a link to that one file that works for
// a short time. Uses the AWS user Sentinel already has (AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY); its policy allows s3:GetObject and s3:PutObject on
// <bucket>/training/* only. TRAINING_VIDEOS_BUCKET overrides the bucket name.

const internalApi: any = internal;
const voiceValidator = v.union(v.literal("default"), v.literal("kenyan"));

function bucket(): string {
  return process.env.TRAINING_VIDEOS_BUCKET?.trim() || DEFAULT_TRAINING_BUCKET;
}

function s3(): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new ConvexError({ code: "unavailable", message: "Training videos aren't set up yet." });
  return new S3Client({ region: TRAINING_VIDEO_REGION, credentials: { accessKeyId, secretAccessKey } });
}

// A playback link for a signed-in viewer allowed to watch this video, and its
// captions as text (shown from a blob, so the browser never fetches them
// from S3).
export const play = action({
  args: { video: v.string(), voice: voiceValidator },
  handler: async (ctx, args): Promise<{ url: string; captions: string | null; expiresAt: number }> => {
    const allowed: { hasCaptions: boolean } | null = await ctx.runQuery(internalApi.trainingVideos._canPlay, args);
    if (!allowed) throw new ConvexError({ code: "not_found", message: "Video not found." });
    const client = s3();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket(),
        Key: trainingVideoKey(args.video, args.voice, "mp4"),
        // Played, never offered as a download; no shared cache keeps it.
        ResponseContentType: "video/mp4",
        ResponseContentDisposition: "inline",
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: PLAY_LINK_SECONDS },
    );
    let captions: string | null = null;
    if (allowed.hasCaptions) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: trainingVideoKey(args.video, args.voice, "vtt") }));
        captions = (await object.Body?.transformToString("utf-8")) ?? null;
      } catch {
        captions = null;
      }
    }
    return { url, captions, expiresAt: Date.now() + PLAY_LINK_SECONDS * 1000 };
  },
});

// tools/videos/publish.mjs: links to upload one video (and its captions).
export const uploadUrls = internalAction({
  args: { video: v.string(), voice: voiceValidator, withCaptions: v.boolean() },
  handler: async (_ctx, args) => {
    if (!trainingVideo(args.video)) throw new ConvexError({ code: "invalid_argument", message: `Unknown video ${args.video}. Run tools/videos/catalog.mjs.` });
    const client = s3();
    const put = (kind: "mp4" | "vtt") =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket(), Key: trainingVideoKey(args.video, args.voice, kind), ContentType: kind === "mp4" ? "video/mp4" : "text/vtt" }),
        { expiresIn: UPLOAD_LINK_SECONDS },
      );
    return { video: await put("mp4"), captions: args.withCaptions ? await put("vtt") : null };
  },
});

// After an upload: checks the files are there and lists the video in Help.
export const confirmUpload = internalAction({
  args: { video: v.string(), voice: voiceValidator },
  handler: async (ctx, args) => {
    const client = s3();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: trainingVideoKey(args.video, args.voice, "mp4") }));
    let hasCaptions = true;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: trainingVideoKey(args.video, args.voice, "vtt") }));
    } catch {
      hasCaptions = false;
    }
    await ctx.runMutation(internalApi.trainingVideos._recordUpload, { video: args.video, voice: args.voice, bytes: head.ContentLength ?? 0, hasCaptions });
    return { bytes: head.ContentLength ?? 0, hasCaptions };
  },
});
