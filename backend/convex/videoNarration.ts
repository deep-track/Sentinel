import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";

// Narration for the training videos (docs: the user manual outline). Each
// video script is split into scenes; every scene is turned into speech by
// ElevenLabs, with character timings for captions, and stored in Convex
// file storage for the local video pipeline to download. Internal only:
//   npx convex run videoNarration:voices '{"search":"Bella"}'
//   npx convex run videoNarration:narrate '{"video":"b11-review-case","voiceId":"…","scenes":[…]}'
// Env: ELEVENLABS_API_KEY (Text to Speech + Voices read).

const API = "https://api.elevenlabs.io";
const TIMEOUT_MS = 60_000;
// One scene of a 2-4 minute video stays well under this.
const MAX_SCENE_CHARS = 2_500;

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new ConvexError({ code: "not_configured", message: "ELEVENLABS_API_KEY isn't set in Convex." });
  return key;
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": apiKey(), Accept: "application/json", ...(init.headers ?? {}) }, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body === "object" ? JSON.stringify((body as { detail?: unknown }).detail ?? body).slice(0, 300) : "";
      throw new ConvexError({ code: "elevenlabs_error", message: `ElevenLabs returned HTTP ${response.status}. ${detail}` });
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// The account's voices matching a name, to find the voice id.
export const voices = internalAction({
  args: { search: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const body = (await call(`/v2/voices?page_size=100${args.search ? `&search=${encodeURIComponent(args.search)}` : ""}`, { method: "GET" })) as { voices?: Array<Record<string, unknown>> };
    return (body.voices ?? []).map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      description: typeof voice.description === "string" ? voice.description.slice(0, 200) : null,
      labels: voice.labels ?? null,
    }));
  },
});

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

// Captions as cues of a few words each, from ElevenLabs' character timings.
export function captionCues(text: string, alignment: Alignment | null, offsetSeconds: number): Array<{ start: number; end: number; text: string }> {
  if (!alignment || !alignment.characters.length) return [];
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let words: string[] = [];
  let word = "";
  let cueStart: number | null = null;
  let wordEnd = 0;
  const flush = () => {
    if (word) words.push(word);
    word = "";
  };
  const close = () => {
    flush();
    if (words.length && cueStart !== null) cues.push({ start: offsetSeconds + cueStart, end: offsetSeconds + wordEnd, text: words.join(" ") });
    words = [];
    cueStart = null;
  };
  alignment.characters.forEach((char, index) => {
    const start = alignment.character_start_times_seconds[index] ?? 0;
    const end = alignment.character_end_times_seconds[index] ?? start;
    if (/\s/.test(char)) {
      flush();
      if (words.length >= 8) close();
      return;
    }
    if (cueStart === null) cueStart = start;
    word += char;
    wordEnd = end;
    // A sentence end closes the cue once it holds two words or more.
    if (/[.!?]/.test(char) && words.length + 1 >= 2) close();
  });
  close();
  return cues;
}

// Speech for each scene, stored in Convex, with its duration and captions.
export const narrate = internalAction({
  args: {
    video: v.string(),
    voiceId: v.string(),
    modelId: v.optional(v.string()),
    languageCode: v.optional(v.string()),
    scenes: v.array(v.object({ id: v.string(), text: v.string() })),
  },
  handler: async (ctx, args) => {
    if (!/^[a-z0-9-]{3,60}$/.test(args.video)) throw new ConvexError({ code: "invalid_argument", message: "video must be a short slug, e.g. b11-review-case." });
    if (!args.scenes.length || args.scenes.length > 40) throw new ConvexError({ code: "invalid_argument", message: "Send 1 to 40 scenes." });
    const out: Array<{ id: string; storageId: string; url: string | null; seconds: number; captions: Array<{ start: number; end: number; text: string }> }> = [];
    let offset = 0;
    let previous: string | undefined;
    for (const [index, scene] of args.scenes.entries()) {
      const text = scene.text.trim();
      if (!text || text.length > MAX_SCENE_CHARS) throw new ConvexError({ code: "invalid_argument", message: `Scene ${scene.id} must have 1 to ${MAX_SCENE_CHARS} characters.` });
      const next = args.scenes[index + 1]?.text.trim();
      const body = (await call(`/v1/text-to-speech/${encodeURIComponent(args.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: args.modelId ?? "eleven_multilingual_v2",
          ...(args.languageCode ? { language_code: args.languageCode } : {}),
          // Neighbouring scenes keep the delivery continuous across cuts.
          ...(previous ? { previous_text: previous } : {}),
          ...(next ? { next_text: next } : {}),
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
        }),
      })) as { audio_base64?: string; alignment?: Alignment | null };
      if (!body.audio_base64) throw new ConvexError({ code: "elevenlabs_error", message: `No audio returned for scene ${scene.id}.` });
      const bytes = Uint8Array.from(atob(body.audio_base64), (char) => char.charCodeAt(0));
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "audio/mpeg" }));
      const ends = body.alignment?.character_end_times_seconds ?? [];
      const seconds = ends.length ? Math.ceil(ends[ends.length - 1] * 100) / 100 : 0;
      out.push({ id: scene.id, storageId, url: await ctx.storage.getUrl(storageId), seconds, captions: captionCues(text, body.alignment ?? null, offset) });
      offset += seconds;
      previous = text;
    }
    return { video: args.video, voiceId: args.voiceId, totalSeconds: Math.round(offset * 10) / 10, scenes: out };
  },
});
