export const dynamic = "force-dynamic";

import Link from "next/link";
import { anyApi } from "convex/server";
import { ChevronLeft, Clock } from "lucide-react";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

// Manual review is resolved by internal reviewers only (see
// backend/convex/reviewQueue.ts — resolve() requires an internal role).
// This is the client-facing, read-only status view: pulls the verification
// via verifications.get (which also gives us clientId, so no separate
// currentAccess lookup is needed), then finds the matching reviewQueue
// entry via reviewQueue.listForClient.

interface KYCReviewPageProps {
  params: Promise<{ id: string }>;
}

type ReviewEntry = {
  _id: string;
  verificationId: string;
  clientId: string;
  triggerType: "client_dispute" | "auto_escalation" | "internal_flag";
  triggerReason: string;
  priority: "low" | "normal" | "high";
  status: "pending" | "in_review" | "resolved";
  resolutionAction?: "confirm" | "keep_verdict" | "escalate" | null;
  resolutionNotes?: string | null;
  resolvedAt?: number | null;
  createdAt: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  in_review: "Escalated — in review",
  resolved: "Resolved",
};

async function getReviewEntry(
  id: string,
): Promise<{ entry: ReviewEntry | null; error?: string }> {
  try {
    const client = await getAuthenticatedConvexClient();
    if (!client) return { entry: null, error: "Authentication is not configured." };

    const verification = await client.query(anyApi.verifications.get, { id });
    if (!verification) {
      return {
        entry: null,
        error: "This record doesn't exist, or you don't have access to it.",
      };
    }

    const entries: ReviewEntry[] = await client.query(anyApi.reviewQueue.listForClient, {
      clientId: verification.clientId,
    });
    const entry = entries.find((row) => row.verificationId === id) ?? null;
    return { entry };
  } catch (error) {
    console.error("[kyc review] Convex query failed", error);
    return { entry: null, error: "Review status is temporarily unavailable." };
  }
}

export default async function KYCReviewPage({ params }: KYCReviewPageProps) {
  const { id } = await params;
  const { entry, error } = await getReviewEntry(id);

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link
          href={`/kyc/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 mb-8"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Record
        </Link>

        {!entry ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
            <p className="text-amber-700 dark:text-amber-400 font-medium">
              {error ?? "This record isn't currently flagged for manual review."}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                {STATUS_LABEL[entry.status] ?? entry.status}
              </h1>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">{entry.triggerReason}</p>
            <p className="text-xs text-slate-400 uppercase tracking-wide">
              Priority: {entry.priority}
            </p>
            {entry.status === "resolved" ? (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-600 dark:text-slate-300">
                Resolved{" "}
                {entry.resolvedAt ? `on ${new Date(entry.resolvedAt).toLocaleString()}` : ""}
                {entry.resolutionNotes ? ` — ${entry.resolutionNotes}` : ""}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                This case has been routed to our compliance team. You don&apos;t need to take any
                action — we&apos;ll notify you once it&apos;s resolved.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
