"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, ChevronRight } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import type { KYIStatus, InvestorProfileData, KYIIdentityData, FinancialDocsData } from "@/backend/lib/kyi-types";
import { InvestorProfileStep } from "@/modules/kyi/steps/investor-profile-step";
import { KYIDocumentStep } from "@/modules/kyi/steps/kyi-document-step";
import { FinancialDocsStep } from "@/modules/kyi/steps/financial-docs-step";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";

interface KYIWizardProps {
  clientId: string;
}

function normalizeStatus(row: { status: string; verdict?: string | null } | undefined | null): KYIStatus {
  if (!row) return "pending";
  if (row.status === "completed") {
    if (row.verdict === "reject") return "declined";
    if (row.verdict === "review") return "requires_review";
    return "approved";
  }
  if (row.status === "failed") return "declined";
  if (row.status === "processing") return "processing";
  return "pending"; // queued
}

export function KYIWizard({ clientId }: KYIWizardProps) {
  // Step state: 0 = profile, 1 = identity, 2 = financial, 3 = completed
  const [currentStep, setCurrentStep] = useState(0);

  // Form data accumulation
  const [profileData, setProfileData] = useState<Partial<InvestorProfileData>>({});
  const [identityData, setIdentityData] = useState<Partial<KYIIdentityData>>({});
  const [financialData, setFinancialData] = useState<Partial<FinancialDocsData>>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [submittedKyiId, setSubmittedKyiId] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  const createKyi = useMutation(anyApi.kyi.createKyi);
  const liveRecord = useQuery(
    anyApi.verifications.get,
    submittedKyiId ? { id: submittedKyiId } : "skip",
  );
  const liveStatus = normalizeStatus(liveRecord);

  const progressPercent = ((currentStep) / 3) * 100;
  const steps = [
    { label: "Profile", number: 1 },
    { label: "Identity", number: 2 },
    { label: "Documents", number: 3 },
  ];

  async function handleProfileSubmit(data: InvestorProfileData) {
    setProfileData(data);
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleIdentitySubmit(data: KYIIdentityData) {
    setIdentityData(data);
    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleFinancialSubmit(data: FinancialDocsData) {
    setFinancialData(data);
    if (
      !profileData.firstName || !profileData.lastName || !profileData.email ||
      !profileData.dateOfBirth || !profileData.investorType || !profileData.accreditationStatus ||
      !profileData.sourceOfFunds || profileData.isPEP === undefined ||
      !identityData.governmentIdType || !identityData.governmentIdUrl || !identityData.governmentIdBase64 ||
      !identityData.selfieUrl || !identityData.selfieBase64 ||
      !data.bankStatementUrl || !data.proofOfAddressUrl
    ) {
      toast.error("Please complete all steps before submitting.");
      return;
    }

    try {
      setIsSubmitting(true);

      const result = await createKyi({
        clientId,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        email: profileData.email,
        phone: profileData.phone,
        nationality: profileData.nationality,
        countryOfResidence: profileData.countryOfResidence,
        dateOfBirth: profileData.dateOfBirth,
        investorType: profileData.investorType,
        accreditationStatus: profileData.accreditationStatus,
        sourceOfFunds: profileData.sourceOfFunds,
        netWorthRange: profileData.netWorthRange,
        investmentAmount: profileData.investmentAmount,
        investmentCurrency: profileData.investmentCurrency,
        isPEP: profileData.isPEP,
        pepDetails: profileData.pepDetails,
        governmentIdType: identityData.governmentIdType,
        governmentIdUrl: identityData.governmentIdUrl,
        governmentIdBase64: identityData.governmentIdBase64,
        governmentIdBackUrl: identityData.governmentIdBackUrl,
        governmentIdBackBase64: identityData.governmentIdBackBase64,
        selfieUrl: identityData.selfieUrl,
        selfieBase64: identityData.selfieBase64,
        bankStatementUrl: data.bankStatementUrl,
        proofOfAddressUrl: data.proofOfAddressUrl,
        proofOfNetWorthUrl: data.proofOfNetWorthUrl,
        accreditationLetterUrl: data.accreditationLetterUrl,
        sourceOfFundsDocUrl: data.sourceOfFundsDocUrl,
        corporateDocUrl: data.corporateDocUrl,
      });

      setSubmittedKyiId(result.id);
      setSubmittedRef(result.reference);
      setCompleted(true);
      setElapsedTime(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Submission failed. Please try again.");
      console.error("[KYI submit] failed", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Elapsed-time display only — liveStatus above already updates
  // reactively via useQuery, no manual polling needed.
  useEffect(() => {
    if (!completed) return;
    const timer = setInterval(() => setElapsedTime((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [completed]);

  // Completed state
  if (completed) {
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;

    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Verification Submitted</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Reference: <code className="font-mono">{submittedRef}</code>
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Submitted {minutes}m {seconds}s ago
        </p>
        <div className="flex justify-center">
          <KYIStatusBadge status={liveStatus} />
        </div>
        {liveRecord?.failureReason ? (
          <p className="text-xs text-amber-600 dark:text-amber-400 max-w-sm mx-auto">
            {liveRecord.failureReason}
          </p>
        ) : null}
        <div className="pt-2">
          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/kyi">Back to KYI Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress Bar */}
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center flex-1">
              <div
                className={`
                  h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm
                  transition-colors
                  ${
                    idx < currentStep
                      ? "bg-emerald-500 text-white"
                      : idx === currentStep
                      ? "bg-blue-500 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  }
                `}
              >
                {idx < currentStep ? "✓" : step.number}
              </div>
              <div className="ml-3">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {step.label}
                </p>
              </div>
              {idx < steps.length - 1 && (
                <ChevronRight className="h-5 w-5 text-slate-300 dark:text-slate-600 mx-2 ml-auto" />
              )}
            </div>
          ))}
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Step Content */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8">
        {currentStep === 0 && (
          <InvestorProfileStep
            defaultValues={profileData}
            onSubmit={handleProfileSubmit}
            isLoading={isSubmitting}
          />
        )}

        {currentStep === 1 && (
          <KYIDocumentStep
            defaultValues={identityData}
            onSubmit={handleIdentitySubmit}
            isLoading={isSubmitting}
          />
        )}

        {currentStep === 2 && (
          <FinancialDocsStep
            defaultValues={financialData}
            onSubmit={handleFinancialSubmit}
            isLoading={isSubmitting}
            investorType={profileData.investorType}
          />
        )}
      </div>

      {/* Back Button */}
      {currentStep > 0 && !completed && (
        <div className="mt-6 flex justify-start">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(currentStep - 1)}
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>
      )}
    </div>
  );
}