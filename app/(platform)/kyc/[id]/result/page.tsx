export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { AlertTriangle, CheckCircle, Clock, ShieldAlert, XCircle } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

interface ResultPageProps {
  params: Promise<{ id: string }>;
}

type VerificationRow = {
  status: "queued" | "processing" | "completed" | "failed";
  verdict?: "pass" | "review" | "reject" | null;
  failureReason?: string | null;
};

type Outcome = "approved" | "declined" | "failed" | "review" | "in_progress" | "unavailable";

// The outcome is read from the stored verification, never from query
// parameters — a `?event=` value in the URL can be edited by anyone.
async function getOutcome(id: string): Promise<{ outcome: Outcome; reason?: string | null }> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { outcome: "unavailable" };
    const row: VerificationRow | null = await client.query(anyApi.verifications.get, { id });
    if (!row) return { outcome: "unavailable" };
    if (row.status === "failed") return { outcome: "failed", reason: row.failureReason };
    if (row.status === "completed") {
      if (row.verdict === "pass") return { outcome: "approved" };
      if (row.verdict === "reject") return { outcome: "declined" };
      return { outcome: "review" };
    }
    return { outcome: "in_progress" };
  } catch (error) {
    console.error("[kyc result] Convex query failed", error);
    return { outcome: "unavailable" };
  }
}

const CONTENT: Record<Outcome, { title: string; body: string; icon: React.ElementType; tone: string }> = {
  approved: {
    title: "Verification approved",
    body: "The identity verification completed successfully.",
    icon: CheckCircle,
    tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  declined: {
    title: "Verification declined",
    body: "The identity could not be verified. See the report for the checks that failed.",
    icon: XCircle,
    tone: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  },
  failed: {
    title: "Verification could not be completed",
    body: "Processing failed before a decision was reached.",
    icon: XCircle,
    tone: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  },
  review: {
    title: "Under manual review",
    body: "This verification was routed to our compliance team. No action is needed.",
    icon: ShieldAlert,
    tone: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  },
  in_progress: {
    title: "Verification in progress",
    body: "The submission was received and is being processed. This usually takes a few minutes.",
    icon: Clock,
    tone: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  },
  unavailable: {
    title: "Status unavailable",
    body: "This record doesn't exist, you don't have access to it, or its status can't be loaded right now.",
    icon: AlertTriangle,
    tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
};

export default async function KYCResultPage({ params }: ResultPageProps) {
  const { id } = await params;
  const { outcome, reason } = await getOutcome(id);
  const content = CONTENT[outcome];
  const Icon = content.icon;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center py-16 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className={`h-20 w-20 rounded-full flex items-center justify-center mx-auto ${content.tone}`}>
          <Icon className="h-10 w-10" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{content.title}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{content.body}</p>
          {outcome === "failed" && reason ? (
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-xs">{reason}</p>
          ) : null}
        </div>

        <div className="flex gap-3 justify-center flex-wrap">
          <Link
            href="/dashboard"
            className="rounded-lg bg-black hover:bg-black/80 text-white text-sm font-medium px-6 py-2.5 transition-colors"
          >
            Go to Dashboard
          </Link>
          {outcome !== "unavailable" ? (
            <Link
              href={`/kyc/${id}`}
              className="rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium px-6 py-2.5 transition-colors"
            >
              View Record
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
