import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireInternalUser } from "./lib/rbac";
import { TRAINING_VOICE_LABELS, trainingVideo, videosForChapter, type TrainingVideo, type TrainingVoice } from "./lib/trainingVideos";

// Who may watch the training videos (lib/trainingVideos.ts): client videos
// are for signed-in members of an active organization and DeepTrack staff;
// Back Office videos are for DeepTrack staff only. Nobody else learns that
// a video exists. The files are played through trainingVideosNode.play.

const voiceValidator = v.union(v.literal("default"), v.literal("kenyan"));

async function viewer(ctx: QueryCtx): Promise<{ staff: boolean; member: boolean } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  let staff = false;
  try {
    await requireInternalUser(ctx, "read");
    staff = true;
  } catch {
    staff = false;
  }
  if (staff) return { staff, member: false };
  const memberships = await ctx.db.query("clientMembers").withIndex("by_user", (q) => q.eq("userId", identity.subject)).take(50);
  for (const membership of memberships.filter((row) => row.isActive)) {
    const client = await ctx.db.get(membership.clientId);
    if (client?.status === "active") return { staff, member: true };
  }
  return { staff, member: false };
}

function mayWatch(who: { staff: boolean; member: boolean } | null, video: TrainingVideo): boolean {
  if (!who) return false;
  return video.internal ? who.staff : who.staff || who.member;
}

async function uploadedVoices(ctx: QueryCtx, video: string) {
  const rows = await ctx.db.query("trainingVideoFiles").withIndex("by_video_and_voice", (q) => q.eq("video", video)).take(10);
  return rows
    .sort((a, b) => (a.voice === "default" ? -1 : b.voice === "default" ? 1 : 0))
    .map((row) => ({ voice: row.voice, label: TRAINING_VOICE_LABELS[row.voice], hasCaptions: row.hasCaptions }));
}

// The chapter's videos this viewer may watch that have been uploaded.
export const forChapter = query({
  args: { chapter: v.string() },
  handler: async (ctx, args) => {
    const who = await viewer(ctx);
    const out: Array<{ id: string; title: string; voices: Array<{ voice: TrainingVoice; label: string; hasCaptions: boolean }> }> = [];
    for (const video of videosForChapter(args.chapter)) {
      if (!mayWatch(who, video)) continue;
      const voices = await uploadedVoices(ctx, video.id);
      if (voices.length) out.push({ id: video.id, title: video.title, voices });
    }
    return out;
  },
});

// For trainingVideosNode.play: may this viewer watch this video in this voice?
export const _canPlay = internalQuery({
  args: { video: v.string(), voice: voiceValidator },
  handler: async (ctx, args) => {
    const video = trainingVideo(args.video);
    if (!video || !mayWatch(await viewer(ctx), video)) return null;
    const file = await ctx.db.query("trainingVideoFiles").withIndex("by_video_and_voice", (q) => q.eq("video", args.video).eq("voice", args.voice)).first();
    return file ? { hasCaptions: file.hasCaptions } : null;
  },
});

export const _recordUpload = internalMutation({
  args: { video: v.string(), voice: voiceValidator, bytes: v.number(), hasCaptions: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("trainingVideoFiles").withIndex("by_video_and_voice", (q) => q.eq("video", args.video).eq("voice", args.voice)).first();
    const row = { video: args.video, voice: args.voice, bytes: args.bytes, hasCaptions: args.hasCaptions, uploadedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("trainingVideoFiles", row);
  },
});
