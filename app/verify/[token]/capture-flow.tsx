"use client";

import { useEffect, useMemo, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { Camera, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { CAPTURE_DOCUMENT_TYPES, CAPTURE_TEXT, type CaptureDocumentType, type CaptureLanguage } from "@/backend/convex/lib/capture";

export type CaptureSessionView =
  | { status: "not_found" }
  | { status: "pending" | "opened" | "submitted" | "expired" | "cancelled"; clientName: string; language: CaptureLanguage; firstName: string | null; needs: string[] };

type Step = "intro" | "document" | "front" | "back" | "selfie" | "details" | "sending" | "done";

// Fits Sentinel's per-image limit (1,000,000 base64 characters) with room
// to spare, and keeps uploads small on slow mobile networks.
const MAX_BASE64 = 900_000;

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// A phone photo (often 4-12 MB) resized and re-encoded as JPEG.
export async function compressPhoto(file: File): Promise<string> {
  const image = await loadImage(file);
  let maxSide = 1600;
  let quality = 0.85;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length <= MAX_BASE64) return base64;
    maxSide = Math.round(maxSide * 0.8);
    quality = Math.max(0.6, quality - 0.07);
  }
  throw new Error("too_large");
}

function PhotoStep({
  title,
  hint,
  facing,
  photo,
  onPhoto,
  onNext,
  onBack,
  text,
}: {
  title: string;
  hint: string;
  facing: "environment" | "user";
  photo: string | null;
  onPhoto: (base64: string) => void;
  onNext: () => void;
  onBack: () => void;
  text: (typeof CAPTURE_TEXT)[CaptureLanguage];
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">{hint}</p>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/jpeg;base64,${photo}`} alt="" className="w-full rounded-xl border border-slate-200 object-contain dark:border-slate-700" />
      ) : null}
      <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-semibold ${photo ? "border border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-100" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"}`}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : photo ? <RotateCcw className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        {busy ? text.compressing : photo ? text.retake : text.takePhoto}
        <input
          type="file"
          accept="image/*"
          capture={facing}
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setFailed(false);
            try {
              onPhoto(await compressPhoto(file));
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {failed ? <p className="text-sm text-red-600">{text.retry}</p> : null}
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium dark:border-slate-600">
          {text.back_}
        </button>
        <button type="button" disabled={!photo || busy} onClick={onNext} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900">
          {text.next}
        </button>
      </div>
    </div>
  );
}

export function CaptureFlow({ token, session, initialLanguage }: { token: string; session: CaptureSessionView; initialLanguage: CaptureLanguage }) {
  const [language, setLanguage] = useState<CaptureLanguage>(initialLanguage);
  const [step, setStep] = useState<Step>("intro");
  const [documentType, setDocumentType] = useState<CaptureDocumentType>("id_card");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const text = CAPTURE_TEXT[language];
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexHttpClient(url) : null;
  }, []);

  useEffect(() => {
    if (client && session.status === "pending") void client.mutation(anyApi.capture.markOpened, { token }).catch(() => undefined);
  }, [client, session.status, token]);

  const languageToggle = (
    <button type="button" onClick={() => setLanguage(language === "en" ? "sw" : "en")} className="text-xs font-medium text-slate-500 underline">
      {text.language}
    </button>
  );

  if (session.status !== "pending" && session.status !== "opened") {
    const message = session.status === "submitted" ? text.used : session.status === "expired" ? text.expired : session.status === "cancelled" ? text.cancelled : text.invalid;
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{languageToggle}</div>
        <p className="text-base text-slate-800 dark:text-slate-100">{message}</p>
      </div>
    );
  }

  const needs = session.needs;
  const afterSelfie: Step = needs.length ? "details" : "sending";

  async function send() {
    if (!client) return;
    setStep("sending");
    setError(null);
    try {
      await client.mutation(anyApi.capture.submit, {
        token,
        consent: true,
        language,
        documentType,
        documentFrontBase64: front!,
        ...(documentType !== "passport" && back ? { documentBackBase64: back } : {}),
        selfieBase64: selfie!,
        ...(needs.length ? { details } : {}),
      });
      setStep("done");
    } catch {
      setError(text.retry);
      setStep(needs.length ? "details" : "selfie");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{languageToggle}</div>

      {step === "intro" ? (
        <div className="space-y-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{session.firstName ? `${session.firstName}, ${text.title.toLowerCase()}` : text.title}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{text.intro(session.clientName)}</p>
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <p className="mb-1 font-semibold">{text.consentTitle}</p>
            <p>{text.consent(session.clientName)}</p>
          </div>
          <button type="button" onClick={() => setStep("document")} className="w-full rounded-xl bg-slate-900 px-4 py-4 text-base font-semibold text-white dark:bg-white dark:text-slate-900">
            {text.agree}
          </button>
        </div>
      ) : null}

      {step === "document" ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{text.documentType}</h2>
          {CAPTURE_DOCUMENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setDocumentType(type);
                setStep("front");
              }}
              className="w-full rounded-xl border border-slate-300 px-4 py-4 text-left text-base font-medium dark:border-slate-600"
            >
              {text.documentTypes[type]}
            </button>
          ))}
        </div>
      ) : null}

      {step === "front" ? (
        <PhotoStep title={text.front} hint={text.frontHint} facing="environment" photo={front} onPhoto={setFront} onBack={() => setStep("document")} onNext={() => setStep(documentType === "passport" ? "selfie" : "back")} text={text} />
      ) : null}
      {step === "back" ? <PhotoStep title={text.back} hint={text.backHint} facing="environment" photo={back} onPhoto={setBack} onBack={() => setStep("front")} onNext={() => setStep("selfie")} text={text} /> : null}
      {step === "selfie" ? (
        <PhotoStep
          title={text.selfie}
          hint={text.selfieHint}
          facing="user"
          photo={selfie}
          onPhoto={setSelfie}
          onBack={() => setStep(documentType === "passport" ? "front" : "back")}
          onNext={() => (afterSelfie === "sending" ? void send() : setStep("details"))}
          text={text}
        />
      ) : null}

      {step === "details" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{text.details}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{text.detailsHint}</p>
          {needs.map((field) => (
            <label key={field} className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              {text[field as "firstName" | "lastName" | "idNumber" | "dateOfBirth" | "gender"]}
              {field === "gender" ? (
                <select required value={details.gender ?? ""} onChange={(event) => setDetails({ ...details, gender: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-600 dark:bg-slate-800">
                  <option value="" disabled>
                    —
                  </option>
                  <option value="male">{text.genders.male}</option>
                  <option value="female">{text.genders.female}</option>
                </select>
              ) : (
                <input
                  required
                  type={field === "dateOfBirth" ? "date" : "text"}
                  inputMode={field === "idNumber" ? "text" : undefined}
                  autoComplete={field === "firstName" ? "given-name" : field === "lastName" ? "family-name" : field === "dateOfBirth" ? "bday" : "off"}
                  maxLength={100}
                  value={details[field] ?? ""}
                  onChange={(event) => setDetails({ ...details, [field]: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-600 dark:bg-slate-800"
                />
              )}
            </label>
          ))}
          <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-4 text-base font-semibold text-white dark:bg-white dark:text-slate-900">
            {text.submit}
          </button>
        </form>
      ) : null}

      {step === "sending" ? (
        <div className="flex items-center gap-3 py-8 text-slate-700 dark:text-slate-200">
          <Loader2 className="h-6 w-6 animate-spin" />
          {text.sending}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="space-y-3 py-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{text.done}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{text.doneText(session.clientName)}</p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
