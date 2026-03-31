"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";
import type { KYIStatus, KYISubmissionData } from "@/lib/kyi-types";
import type { KYCSubmissionData } from "@/lib/kyc-types";
import { submitKYI, getKYIRecord } from "@/actions/kyi";
import { InvestorClassificationStep } from "@/modules/kyi/steps/investor-classification-step";
import { InvestorFinancialDocsStep } from "@/modules/kyi/steps/investor-financial-docs-step";
import { DocumentCaptureStep } from "@/modules/kyc/steps/document-capture-step";
import { SelfieCaptureStep } from "@/modules/kyc/steps/selfie-capture-step";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface KYIWizardProps {
}

function toKycDocType(
  governmentIdType?: KYISubmissionData["governmentIdType"],
): KYCSubmissionData["documentType"] | undefined {
  if (!governmentIdType) return undefined;
  const map: Record<KYISubmissionData["governmentIdType"], KYCSubmissionData["documentType"]> = {
    passport: "passport",
    national_id: "id_card",
    driving_license: "driving_license",
  };
  return map[governmentIdType];
}

function toKyiGovernmentIdType(
  documentType: KYCSubmissionData["documentType"],
): KYISubmissionData["governmentIdType"] {
  const map: Record<KYCSubmissionData["documentType"], KYISubmissionData["governmentIdType"]> = {
    passport: "passport",
    id_card: "national_id",
    driving_license: "driving_license",
  };
  return map[documentType];
}

export function KYIWizard({}: KYIWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [identitySubStep, setIdentitySubStep] = useState(0);
  const [data, setData] = useState<Partial<KYISubmissionData>>({});
  const [completed, setCompleted] = useState(false);
  const [liveStatus, setLiveStatus] = useState<KYIStatus>("processing");
  const [submittedKyiId, setSubmittedKyiId] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  function handleClassification(
    values: Pick<
      KYISubmissionData,
      "investorType" | "accreditationStatus" | "investmentAmount" | "investmentCurrency" | "sourceOfFunds" | "isPEP"
    >,
  ) {
    setData((previous) => ({ ...previous, ...values }));
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleDocumentCapture(
    values: Pick<
      KYCSubmissionData,
      "documentType" | "documentFrontUrl" | "documentBackUrl" | "documentFrontBase64" | "documentBackBase64"
    >,
  ) {
    setData((previous) => ({
      ...previous,
      governmentIdType: toKyiGovernmentIdType(values.documentType),
      governmentIdUrl: values.documentFrontUrl,
      governmentIdBase64: values.documentFrontBase64,
    }));
    setIdentitySubStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelfieCapture(values: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64">) {
    setData((previous) => ({ ...previous, selfieUrl: values.selfieUrl, selfieBase64: values.selfieBase64 }));
    setCurrentStep(2);
    setIdentitySubStep(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(
    finalDocs: Pick<
      KYISubmissionData,
      | "bankStatementUrl"
      | "proofOfAddressUrl"
      | "proofOfNetWorthUrl"
      | "accreditationLetterUrl"
      | "sourceOfFundsDocUrl"
      | "corporateDocUrl"
    >,
  ) {
    const payload: Partial<KYISubmissionData> = { ...data, ...finalDocs };
    if (
      !payload.investorType ||
      !payload.accreditationStatus ||
      !payload.investmentAmount ||
      !payload.investmentCurrency ||
      !payload.sourceOfFunds ||
      payload.isPEP === undefined ||
      !payload.governmentIdType ||
      !payload.governmentIdUrl ||
      !payload.governmentIdBase64 ||
      !payload.selfieUrl ||
      !payload.selfieBase64 ||
      !payload.bankStatementUrl ||
      !payload.proofOfAddressUrl
    ) {
      toast.error("Please complete all steps before submitting.");
      return;
    }

    const result = await submitKYI({
      investorType: payload.investorType,
      accreditationStatus: payload.accreditationStatus,
      investmentAmount: payload.investmentAmount,
      investmentCurrency: payload.investmentCurrency,
      sourceOfFunds: payload.sourceOfFunds,
      isPEP: payload.isPEP,
      governmentIdType: payload.governmentIdType,
      governmentIdUrl: payload.governmentIdUrl,
      governmentIdBase64: payload.governmentIdBase64,
      selfieUrl: payload.selfieUrl,
      selfieBase64: payload.selfieBase64,
      bankStatementUrl: payload.bankStatementUrl,
      proofOfAddressUrl: payload.proofOfAddressUrl,
      proofOfNetWorthUrl: payload.proofOfNetWorthUrl,
      accreditationLetterUrl: payload.accreditationLetterUrl,
      sourceOfFundsDocUrl: payload.sourceOfFundsDocUrl,
      corporateDocUrl: payload.corporateDocUrl,
    });

    if (!result.success) {
      toast.error(result.error ?? "Submission failed. Please try again.");
      return;
    }

    setSubmittedKyiId(result.data.kyiId);
    setSubmittedRef(result.data.reference);
    setCompleted(true);
    setLiveStatus("processing");
  }

  useEffect(() => {
    if (!completed || !submittedKyiId) return;

    pollRef.current = setInterval(async () => {
      const res = await getKYIRecord(submittedKyiId);
      if (!res.success || !res.data) return;

      const status = res.data.status;
      setLiveStatus(status);

      if (["approved", "declined", "expired"].includes(status)) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [completed, submittedKyiId]);

  if (completed) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Verification Submitted</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Reference: <code className="font-mono">{submittedRef}</code>
        </p>
        <div className="flex justify-center">
          <KYIStatusBadge status={liveStatus} />
        </div>
        <div className="pt-2">
          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/kyi">Back to KYI Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8">
        {currentStep === 0 && <InvestorClassificationStep defaultValues={data} onNext={handleClassification} />}

        {currentStep === 1 && identitySubStep === 0 && (
          <DocumentCaptureStep
            defaultValues={{
              documentType: toKycDocType(data.governmentIdType),
              documentFrontUrl: data.governmentIdUrl ?? "",
              documentFrontBase64: data.governmentIdBase64 ?? "",
              documentBackUrl: "",
              documentBackBase64: "",
              selfieUrl: "placeholder",
              selfieBase64: "placeholder",
            }}
            onNext={handleDocumentCapture}
          />
        )}

        {currentStep === 1 && identitySubStep === 1 && (
          <SelfieCaptureStep
            defaultValues={{
              selfieUrl: data.selfieUrl ?? "",
              selfieBase64: data.selfieBase64 ?? "",
            } as Partial<KYCSubmissionData>}
            onNext={handleSelfieCapture}
            onBack={() => setIdentitySubStep(0)}
          />
        )}

        {currentStep === 2 && (
          <InvestorFinancialDocsStep
            defaultValues={data}
            onBack={() => {
              setCurrentStep(1);
              setIdentitySubStep(1);
            }}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}
