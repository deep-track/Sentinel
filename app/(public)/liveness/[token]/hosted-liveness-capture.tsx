"use client";

import { useEffect, useMemo, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { AlertCircle, CheckCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/modules/shared/errors";
import { LivenessVideoRecorder, type RecordedClip } from "@/modules/shared/liveness-video-recorder";

type Session =
  | { state: "ready"; message: null; organisation: string | null; expiresAt: number | null }
  | { state: "invalid" | "expired" | "submitted" | "closed"; message: string };

type View = { kind: "loading" } | { kind: "unavailable"; message: string } | { kind: "capture"; organisation: string | null } | { kind: "done" };

export function HostedLivenessCapture({ token }: { token: string }) {
  // No auth: the link token is the credential, so a plain HTTP client is enough.
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexHttpClient(url) : null;
  }, []);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setView({ kind: "unavailable", message: "This page is not configured. Please contact the organisation that sent you the link." });
      return;
    }
    let cancelled = false;
    client
      .query(anyApi.liveness.publicSession, { token, now: Date.now() })
      .then((session: Session) => {
        if (cancelled) return;
        setView(
          session.state === "ready"
            ? { kind: "capture", organisation: session.organisation }
            : { kind: "unavailable", message: session.message },
        );
      })
      .catch(() => {
        if (!cancelled) setView({ kind: "unavailable", message: "We couldn't open this verification link. Check your connection and reload the page." });
      });
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  async function submit() {
    if (!client || !clip) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await client.mutation(anyApi.liveness.submitPublicCapture, { token, videoBase64: clip.base64, mediaType: clip.mediaType });
      setView({ kind: "done" });
    } catch (error) {
      setSubmitError(getErrorMessage(error, "The video could not be sent. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  if (view.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your verification…
      </div>
    );
  }

  if (view.kind === "unavailable") {
    return (
      <div className="space-y-3 py-6 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">This link can&apos;t be used</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{view.message}</p>
      </div>
    );
  }

  if (view.kind === "done") {
    return (
      <div className="space-y-3 py-6 text-center">
        <CheckCircle className="mx-auto h-10 w-10 text-emerald-600" />
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Thank you, your video was sent</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You can close this page. The organisation will be told the result; you don&apos;t need to do anything else.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300">
          <ShieldCheck className="h-4 w-4" /> Identity verification
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Record a short video of your face</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {view.organisation ? `${view.organisation} asked` : "You were asked"} to confirm that you are a real person
          by recording a 5-second video. It is checked by Deeptrack and used only for this verification.
        </p>
      </div>

      <LivenessVideoRecorder onClipChange={setClip} onBusyChange={setBusy} />

      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          I agree that this video of my face is processed by Deeptrack to verify my identity for{" "}
          {view.organisation ?? "the organisation that sent this link"}.
        </span>
      </label>

      {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

      <Button
        type="button"
        onClick={submit}
        disabled={!clip || !consent || busy || submitting}
        className="w-full bg-violet-600 text-white hover:bg-violet-700"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          "Send video"
        )}
      </Button>
    </div>
  );
}
