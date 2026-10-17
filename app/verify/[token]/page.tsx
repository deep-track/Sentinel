import Image from "next/image";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CAPTURE_TEXT, type CaptureLanguage } from "@/backend/convex/lib/capture";
import { CaptureFlow, type CaptureSessionView } from "./capture-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your identity | Sentinel", robots: { index: false, follow: false } };

// The customer's identity capture page (backend/convex/capture.ts), opened
// from an SMS or WhatsApp link. No account: the token in the link is the key.
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  let session: CaptureSessionView = { status: "not_found" };
  if (convexUrl) {
    try {
      session = (await new ConvexHttpClient(convexUrl).query(anyApi.capture.session, { token })) as CaptureSessionView;
    } catch {
      session = { status: "not_found" };
    }
  }
  const language: CaptureLanguage = session.status !== "not_found" ? session.language : "en";
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 dark:bg-slate-950">
      <div className="mx-auto max-w-md">
        <div className="flex justify-center">
          <Image src="/deeptrack-transparent.png" alt="DeepTrack" width={140} height={30} priority className="dark:invert" />
        </div>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CaptureFlow token={token} session={session} initialLanguage={language} />
        </section>
        <p className="mt-4 text-center text-xs text-slate-500">{language === "sw" ? CAPTURE_TEXT.sw.title : CAPTURE_TEXT.en.title} · Sentinel by DeepTrack</p>
      </div>
    </main>
  );
}
