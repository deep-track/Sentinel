"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDate } from "@/components/client-date";
import { getErrorMessage } from "@/modules/shared/errors";

// The AI hit review on a case (backend/convex/aiHitReview.ts): Claude's
// recommendation, with its reasons for each hit. It only recommends; the
// reviewer decides.

export type AiAssessment =
  | { status: "pending"; requestedAt: number }
  | { status: "failed"; completedAt: number; error: string }
  | {
      status: "done";
      completedAt: number;
      model: string;
      recommendation: "clear" | "confirm" | "escalate";
      confidence: "high" | "medium" | "low";
      summary: string;
      guardrail: string | null;
      hits: Array<{ index: number; name: string; source: string; assessment: "same_person" | "different_person" | "unclear"; confidence: string; reasons: string[]; missingInformation: string[] }>;
    };

export type DecisionSuggestion = { action: "approve" | "reject"; notes: string; at: number };

const RECOMMENDATION: Record<"clear" | "confirm" | "escalate", { label: string; tone: string; detail: string }> = {
  clear: { label: "Clear the hits", tone: "text-emerald-700 dark:text-emerald-400", detail: "Every hit looks like a different person." },
  confirm: { label: "Confirm the match", tone: "text-red-700 dark:text-red-400", detail: "At least one hit looks like this customer." },
  escalate: { label: "Get more information", tone: "text-amber-700 dark:text-amber-400", detail: "The evidence doesn't settle it yet." },
};
const ASSESSMENT: Record<string, { label: string; tone: string }> = {
  different_person: { label: "Different person", tone: "text-emerald-700 dark:text-emerald-400" },
  same_person: { label: "Same person", tone: "text-red-700 dark:text-red-400" },
  unclear: { label: "Unclear", tone: "text-amber-700 dark:text-amber-400" },
};

export function AiAssessmentPanel({
  reviewId,
  assessment,
  available,
  canWork,
  canDecide,
  onUse,
}: {
  reviewId: string;
  assessment: AiAssessment | null;
  available: boolean;
  canWork: boolean;
  canDecide: boolean;
  onUse: (suggestion: DecisionSuggestion) => void;
}) {
  const request = useMutation(anyApi.aiHitReview.request);
  const [busy, setBusy] = useState(false);
  if (!available && !assessment) return null;

  const run = async () => {
    setBusy(true);
    try {
      await request({ reviewId });
    } catch (error) {
      toast.error(getErrorMessage(error, "The AI review couldn't be started."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> AI hit review
          </h2>
          <p className="text-xs text-muted-foreground">A recommendation with reasons. You make the decision.</p>
        </div>
        {canWork && available ? (
          <Button size="sm" variant="outline" disabled={busy || assessment?.status === "pending"} onClick={() => void run()}>
            {busy || assessment?.status === "pending" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {assessment ? "Run again" : "Review the hits with AI"}
          </Button>
        ) : null}
      </div>

      {!assessment ? (
        <p className="text-sm text-muted-foreground">Not run for this case yet.</p>
      ) : assessment.status === "pending" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reviewing the hits…
        </p>
      ) : assessment.status === "failed" ? (
        <p className="text-sm text-red-700">{assessment.error}</p>
      ) : (
        <>
          <div>
            <p className={`text-lg font-semibold ${RECOMMENDATION[assessment.recommendation].tone}`}>{RECOMMENDATION[assessment.recommendation].label}</p>
            <p className="text-xs text-muted-foreground">
              {RECOMMENDATION[assessment.recommendation].detail} Confidence: {assessment.confidence}. <ClientDate value={assessment.completedAt} format="PPp" />
            </p>
            <p className="mt-2 text-sm">{assessment.summary}</p>
            {assessment.guardrail ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{assessment.guardrail}</p> : null}
          </div>
          <ul className="space-y-3">
            {assessment.hits.map((hit) => (
              <li key={hit.index} className="text-sm">
                <p>
                  <span className="font-medium">{hit.name}</span> <span className="text-xs text-muted-foreground">({hit.source.replace(/_/g, " ").toLowerCase()})</span>{" "}
                  <span className={`text-xs font-semibold ${ASSESSMENT[hit.assessment].tone}`}>{ASSESSMENT[hit.assessment].label}</span>
                  <span className="text-xs text-muted-foreground"> · {hit.confidence} confidence</span>
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {hit.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                  {hit.missingInformation.map((item, index) => (
                    <li key={`m${index}`} className="text-amber-700 dark:text-amber-400">
                      To settle it: {item}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {canDecide && assessment.recommendation !== "escalate" ? (
            <Button
              size="sm"
              onClick={() =>
                onUse({
                  action: assessment.recommendation === "clear" ? "approve" : "reject",
                  notes: `AI-assisted review (${assessment.confidence} confidence): ${assessment.summary}`.slice(0, 2000),
                  at: Date.now(),
                })
              }
            >
              Use this recommendation in my decision
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
