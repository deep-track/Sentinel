"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { KYCStatus, KYCSubmissionData } from "@/lib/kyc-types";
import { getKYCRecord, submitKYC } from "@/actions/kyc";
import {
  getRemediationSummary,
  getDeclineBreakdown,
} from "@/lib/shufti-decline-codes";
import { DocumentCaptureStep } from "@/modules/kyc/steps/document-capture-step";
import { SelfieCaptureStep } from "@/modules/kyc/steps/selfie-capture-step";
import { SubmitStep } from "@/modules/kyc/steps/submit-step";
import { CheckCircle, FileText, ClipboardCheck, Camera, AlertCircle, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface KYCWizardProps {
  prefillEmail?: string;
}

const STEPS = [
  { id: 0, title: "Document Capture", icon: FileText, shortTitle: "Document" },
  { id: 1, title: "Selfie Capture", icon: Camera, shortTitle: "Selfie" },
  { id: 2, title: "Review & Submit", icon: ClipboardCheck, shortTitle: "Submit" },
];

export function KYCWizard({}: KYCWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<Partial<KYCSubmissionData>>({});
  const [submittedKycId, setSubmittedKycId] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [liveStatus, setLiveStatus] = useState<KYCStatus>("processing");
  const [declineBreakdown, setDeclineBreakdown] = useState<ReturnType<typeof getDeclineBreakdown> | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  function handleDocument(values: Pick<KYCSubmissionData, "documentType" | "documentFrontUrl" | "documentBackUrl" | "documentFrontBase64" | "documentBackBase64">) {
    setData((d) => ({ ...d, ...values }));
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelfie(values: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64">) {
    setData((d) => ({ ...d, ...values }));
    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (!data.documentType || !data.documentFrontUrl || !data.documentFrontBase64 || !data.selfieUrl || !data.selfieBase64) {
      toast.error("Please complete all steps before submitting.");
      return;
    }

    const result = await submitKYC({
      documentType: data.documentType,
      documentFrontUrl: data.documentFrontUrl,
      documentBackUrl: data.documentBackUrl,
      documentFrontBase64: data.documentFrontBase64,
      documentBackBase64: data.documentBackBase64,
      selfieUrl: data.selfieUrl,
      selfieBase64: data.selfieBase64,
    });

    if (!result.success) {
      toast.error(result.error ?? "Submission failed. Please try again.");
      return;
    }

    setSubmittedKycId(result.data.kycId);
    setSubmittedRef(result.data.reference);
    setLiveStatus("processing");
    setCompleted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!completed || !submittedKycId) return;

    let stopped = false;

    async function poll() {
      if (stopped) return;

      try {
        const result = await getKYCRecord(submittedKycId!);

        if (!result.success || !result.data) return;

        const { status, declinedCodes, servicesDeclinedCodes, declineReason } =
          result.data;

        console.log("[Wizard Poll] status:", status);
        console.log("[Wizard Poll] declinedCodes:", declinedCodes);

        setLiveStatus(status);

        if (status === "declined") {
          // Build human-readable breakdown from codes
          const breakdown = getDeclineBreakdown(
            declinedCodes,
            servicesDeclinedCodes as {
              document?: string[];
              face?: string[];
              address?: string[];
            } | null,
            declineReason
          );
          console.log("[Wizard Poll] breakdown primary:", breakdown.primary);
          setDeclineBreakdown(breakdown);
          stopped = true;
        }

        if (status === "approved" || status === "expired") {
          stopped = true;
        }
      } catch (err) {
        console.error("[Wizard Poll] error:", err);
      }
    }

    // Poll immediately then every 3 seconds
    poll();
    const pollInterval = setInterval(poll, 3000);

    return () => {
      stopped = true;
      clearInterval(pollInterval);
    };
  }, [completed, submittedKycId]);

  if (completed) {
    // Declined verification screen
    if (liveStatus === "declined" && declineBreakdown) {
      return (
        <div className="flex flex-col items-center space-y-6 max-w-md mx-auto">
          {/* Red icon */}
          <div className="h-24 w-24 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <XCircle className="h-12 w-12 text-red-600" />
          </div>

          {/* Title — uses specific code title or generic */}
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              {declineBreakdown.primary?.title ??
               "Verification Unsuccessful"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {declineBreakdown.humanReason ??
               "We could not verify your identity."}
            </p>
          </div>

          {/* Fix guidance box */}
          {declineBreakdown.primary?.userAction && (
            <div className="w-full rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-4">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-2">
                <span>💡</span>
                How to fix this:
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
                {declineBreakdown.primary.userAction}
              </p>
            </div>
          )}

          {/* Per-service breakdown */}
          {(() => {
            const allIssues = [
              ...(declineBreakdown.byService?.document ?? []),
              ...(declineBreakdown.byService?.face ?? []),
            ];
            if (allIssues.length <= 1) return null;
            return (
              <div className="w-full space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  All issues detected:
                </p>
                {allIssues.map((d) => (
                  <div key={d.code} className="flex items-start gap-2 text-left">
                    <span className="text-xs font-mono text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                      {d.code}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {d.service === "face" ? "Selfie" : "Document"}: {d.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {d.userAction}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* All codes raw (for reference) */}
          {(declineBreakdown.allCodes?.length ?? 0) > 0 && (
            <div className="w-full">
              <p className="text-xs text-slate-400 mb-1">Decline codes:</p>
              <div className="flex flex-wrap gap-1">
                {declineBreakdown.allCodes.map((c) => (
                  <span
                    key={c}
                    className="text-xs font-mono bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Try again */}
          <button
            onClick={() => {
              setCompleted(false);
              setCurrentStep(0);
              setData({});
              setLiveStatus("processing");
              setDeclineBreakdown(null);
            }}
            className="w-full rounded-lg bg-black hover:bg-black/80 text-white text-sm font-medium py-3 transition-colors"
          >
            Try Again
          </button>

          {/* Reference */}
          {submittedRef && (
            <p className="text-xs text-slate-400 font-mono">{submittedRef}</p>
          )}
        </div>
      );
    }

    // Default completed screen (processing/approved)
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Verification Submitted</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Reference: <code className="font-mono">{submittedRef}</code>
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          We are verifying your documents. This page updates automatically.
        </p>
        <div className="flex justify-center">
          <KYCStatusBadge status={liveStatus} />
        </div>
        <div className="pt-2">
          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/kyc">Back to KYC Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center">
          {STEPS.map((step, idx) => (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all duration-200",
                    idx < currentStep
                      ? "bg-violet-600 border-violet-600 text-white"
                      : idx === currentStep
                      ? "border-violet-600 text-violet-600 bg-white dark:bg-slate-900"
                      : "border-slate-300 dark:border-slate-600 text-slate-400 bg-white dark:bg-slate-900",
                  )}
                >
                  {idx < currentStep ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-4 w-4" />
                  )}
                </div>
                <span
                  className={cn(
                    "mt-1.5 text-xs font-medium hidden sm:block",
                    idx === currentStep
                      ? "text-violet-600 dark:text-violet-400"
                      : idx < currentStep
                      ? "text-violet-500"
                      : "text-slate-400 dark:text-slate-500",
                  )}
                >
                  {step.shortTitle}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div className="flex-1 mx-2 sm:mx-3 mb-4">
                  <div
                    className={cn(
                      "h-0.5 w-full transition-all duration-300",
                      idx < currentStep ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-700",
                    )}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{STEPS[currentStep].title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Step {currentStep + 1} of {STEPS.length}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8">
        {currentStep === 0 && (
          <DocumentCaptureStep defaultValues={data} onNext={handleDocument} />
        )}
        {currentStep === 1 && (
          <SelfieCaptureStep
            defaultValues={data}
            onNext={handleSelfie}
            onBack={() => setCurrentStep(0)}
          />
        )}
        {currentStep === 2 && (
          <SubmitStep
            data={data}
            onSubmit={handleSubmit}
            onBack={() => setCurrentStep(1)}
            onEdit={(step: number) => setCurrentStep(step)}
          />
        )}
      </div>
    </div>
  );
}
