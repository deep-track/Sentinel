"use client";

import { useAction } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";

type Voice = "default" | "kenyan";
type ChapterVideo = { id: string; title: string; voices: Array<{ voice: Voice; label: string; hasCaptions: boolean }> };
type Source = { url: string; captionsUrl: string | null };

// The chapter's training videos. They play only inside Sentinel: the file
// stays in DeepTrack's private storage and each play gets a link that works
// for a short time, for a signed-in viewer allowed to see it. Nothing is
// loaded until the viewer presses play.
export function HelpVideos({ chapterId }: { chapterId: string }) {
  const videos = useAuthedQuery(anyApi.trainingVideos.forChapter, { chapter: chapterId }) as ChapterVideo[] | undefined;
  if (!videos?.length) return null;
  return (
    <div className="mt-6 space-y-6">
      {videos.map((video) => (
        <HelpVideo key={video.id} video={video} />
      ))}
    </div>
  );
}

function HelpVideo({ video }: { video: ChapterVideo }) {
  const play = useAction(anyApi.trainingVideosNode.play);
  const element = useRef<HTMLVideoElement>(null);
  const [voice, setVoice] = useState<Voice>(video.voices[0].voice);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where to carry on after a voice switch or a fresh link.
  const resume = useRef<{ at: number; playing: boolean } | null>(null);
  const retries = useRef(0);

  const load = useCallback(
    async (next: Voice) => {
      setLoading(true);
      setError(null);
      try {
        const result = (await play({ video: video.id, voice: next })) as { url: string; captions: string | null };
        setSource((previous) => {
          if (previous?.captionsUrl) URL.revokeObjectURL(previous.captionsUrl);
          return { url: result.url, captionsUrl: result.captions ? URL.createObjectURL(new Blob([result.captions], { type: "text/vtt" })) : null };
        });
      } catch {
        setError("The video couldn't be loaded. Try again in a moment.");
      } finally {
        setLoading(false);
      }
    },
    [play, video.id],
  );

  useEffect(
    () => () => {
      if (source?.captionsUrl) URL.revokeObjectURL(source.captionsUrl);
    },
    [source],
  );

  const switchVoice = (next: Voice) => {
    if (next === voice) return;
    const current = element.current;
    if (current && source) resume.current = { at: current.currentTime, playing: !current.paused };
    setVoice(next);
    if (source) void load(next);
  };

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
      {source ? (
        <video
          ref={element}
          key={source.url}
          src={source.url}
          controls
          autoPlay={resume.current?.playing ?? true}
          playsInline
          preload="metadata"
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={(event) => {
            if (resume.current) {
              event.currentTarget.currentTime = resume.current.at;
              if (resume.current.playing) void event.currentTarget.play().catch(() => undefined);
              resume.current = null;
            }
            retries.current = 0;
          }}
          onError={(event) => {
            // The link may have run out during a long pause: get a fresh one
            // and carry on where the viewer was.
            if (retries.current >= 2) return setError("The video stopped loading. Reload the page to try again.");
            retries.current += 1;
            resume.current = { at: event.currentTarget.currentTime, playing: true };
            void load(voice);
          }}
          className="aspect-video w-full bg-black"
        >
          {source.captionsUrl ? <track kind="captions" srcLang="en" label="English" src={source.captionsUrl} default /> : null}
        </video>
      ) : (
        <button
          type="button"
          onClick={() => void load(voice)}
          disabled={loading}
          className="flex aspect-video w-full flex-col items-center justify-center gap-3 text-white transition hover:bg-slate-900"
        >
          {loading ? <Loader2 className="h-12 w-12 animate-spin opacity-80" aria-hidden="true" /> : <PlayCircle className="h-14 w-14 opacity-90" aria-hidden="true" />}
          <span className="text-base font-medium">{video.title}</span>
          <span className="text-xs text-slate-400">Training video</span>
        </button>
      )}
      <figcaption className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 text-sm dark:bg-slate-900">
        <span className="font-medium text-slate-900 dark:text-white">{video.title}</span>
        {video.voices.length > 1 ? (
          <span role="group" aria-label="Narration voice" className="inline-flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            {video.voices.map((option) => (
              <button
                key={option.voice}
                type="button"
                aria-pressed={voice === option.voice}
                onClick={() => switchVoice(option.voice)}
                className={`px-3 py-1 text-xs ${voice === option.voice ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}
              >
                {option.voice === "kenyan" ? "Listen with a Kenyan voice" : option.label}
              </button>
            ))}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
