import type { Metadata } from "next";
import { HostedLivenessCapture } from "./hosted-liveness-capture";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Liveness check · DeepTrack Sentinel",
  // The link is a one-time credential: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Public page the liveness SMS links to (LIVENESS_PUBLIC_URL/liveness/<token>).
// No sign-in: the token in the URL is the only credential, checked in Convex.
export default async function HostedLivenessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8 dark:bg-slate-950 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <HostedLivenessCapture token={token} />
      </div>
    </main>
  );
}
