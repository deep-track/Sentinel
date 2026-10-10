"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Camera, CheckCircle, ClipboardCheck, FileText, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { KYCStatus } from "@/backend/lib/kyc-types";
import { cn } from "@/backend/lib/utils";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";
import { DocumentCaptureStep } from "@/modules/kyc/steps/document-capture-step";
import { SelfieCaptureStep } from "@/modules/kyc/steps/selfie-capture-step";
import { SubmitStep } from "@/modules/kyc/steps/submit-step";
import type {
	KYCDocumentData,
	KYCIdentityData,
	KYCSelfieData,
	KYCWizardData,
} from "@/modules/kyc/types";
import { getErrorMessage } from "@/modules/shared/errors";

interface KYCWizardProps {
	clientId: string;
}

type VerificationRow = {
	status: "queued" | "processing" | "completed" | "failed";
	verdict?: "pass" | "review" | "reject" | null;
	failureReason?: string | null;
};

const STEPS = [
	{ id: 0, title: "Document Capture", icon: FileText, shortTitle: "Document" },
	{ id: 1, title: "Selfie Capture", icon: Camera, shortTitle: "Selfie" },
	{ id: 2, title: "Review & Submit", icon: ClipboardCheck, shortTitle: "Submit" },
];

function toKycStatus(row: VerificationRow | null | undefined): KYCStatus {
	if (!row) return "processing";
	if (row.status === "completed") {
		if (row.verdict === "pass") return "approved";
		if (row.verdict === "reject") return "declined";
		return "requires_review";
	}
	if (row.status === "failed") return "declined";
	if (row.status === "queued") return "pending";
	return "processing";
}

export function KYCWizard({ clientId }: KYCWizardProps) {
	const createKyc = useMutation(anyApi.verifications.createKyc);
	const [currentStep, setCurrentStep] = useState(0);
	const [data, setData] = useState<KYCWizardData>({});
	const [submitted, setSubmitted] = useState<{ id: string; reference: string } | null>(null);

	// Live status of the submitted verification; updates reactively.
	const liveRecord = useAuthedQuery(
		anyApi.verifications.get,
		submitted ? { id: submitted.id } : "skip",
	) as VerificationRow | null | undefined;
	const liveStatus = toKycStatus(liveRecord);

	function goTo(step: number) {
		setCurrentStep(step);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	function handleDocument(values: KYCDocumentData) {
		// Overwrite the back-side fields explicitly so switching to a passport
		// clears a previously captured back image.
		setData((d) => ({
			...d,
			...values,
			documentBackUrl: values.documentBackUrl,
			documentBackBase64: values.documentBackBase64,
		}));
		goTo(1);
	}

	function handleSelfie(values: KYCSelfieData) {
		setData((d) => ({ ...d, ...values }));
		goTo(2);
	}

	async function handleSubmit(identity: KYCIdentityData) {
		if (
			!data.documentType || !data.documentFrontUrl || !data.documentFrontBase64 ||
			!data.selfieUrl || !data.selfieBase64
		) {
			toast.error("Please complete the document and selfie steps before submitting.");
			return;
		}
		const twoSided = data.documentType !== "passport";
		if (twoSided && (!data.documentBackUrl || !data.documentBackBase64)) {
			toast.error("Upload the back of the document before submitting.");
			goTo(0);
			return;
		}

		try {
			const result: { id: string; reference: string } = await createKyc({
				clientId,
				firstName: identity.firstName,
				lastName: identity.lastName,
				idNumber: identity.idNumber,
				dateOfBirth: identity.dateOfBirth,
				gender: identity.gender,
				documentType: data.documentType,
				documentFrontUrl: data.documentFrontUrl,
				documentFrontBase64: data.documentFrontBase64,
				documentBackUrl: twoSided ? data.documentBackUrl : undefined,
				documentBackBase64: twoSided ? data.documentBackBase64 : undefined,
				selfieUrl: data.selfieUrl,
				selfieBase64: data.selfieBase64,
				// No livenessFramesBase64: a still selfie is not liveness evidence.
			});
			setSubmitted(result);
			window.scrollTo({ top: 0, behavior: "smooth" });
		} catch (error) {
			toast.error(getErrorMessage(error, "Submission failed. Please try again."));
		}
	}

	function startOver() {
		setSubmitted(null);
		setCurrentStep(0);
		setData({});
	}

	if (submitted) {
		if (liveStatus === "declined") {
			const reason = liveRecord?.failureReason;
			const failed = liveRecord?.status === "failed";
			return (
				<div className="flex flex-col items-center space-y-6 max-w-md mx-auto">
					<div className="h-24 w-24 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
						<XCircle className="h-12 w-12 text-red-600" />
					</div>
					<div className="text-center space-y-2">
						<h2 className="text-2xl font-bold text-slate-900 dark:text-white">
							{failed ? "Verification could not be completed" : "Verification declined"}
						</h2>
						<p className="text-sm text-slate-500 dark:text-slate-400">
							{reason ?? "We could not verify this identity."}
						</p>
					</div>
					<div className="flex w-full flex-col gap-2">
						<Button onClick={startOver} className="w-full bg-black hover:bg-black/80 text-white">
							Start a new verification
						</Button>
						<Button asChild variant="outline" className="w-full">
							<Link href={`/kyc/${submitted.id}`}>View report</Link>
						</Button>
					</div>
					<p className="text-xs text-slate-400 font-mono">{submitted.reference}</p>
				</div>
			);
		}

		return (
			<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
				<div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
					<CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
				</div>
				<h2 className="text-xl font-bold text-slate-900 dark:text-white">
					Verification Submitted
				</h2>
				<p className="text-sm text-slate-500 dark:text-slate-400">
					Reference: <code className="font-mono">{submitted.reference}</code>
				</p>
				<p className="text-sm text-slate-500 dark:text-slate-400">
					{liveStatus === "approved" || liveStatus === "requires_review"
						? "Processing is complete."
						: "We are verifying the documents. This page updates automatically."}
				</p>
				<div className="flex justify-center">
					<KYCStatusBadge status={liveStatus} />
				</div>
				<div className="flex flex-wrap justify-center gap-2 pt-2">
					<Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
						<Link href={`/kyc/${submitted.id}`}>View report</Link>
					</Button>
					<Button asChild variant="outline">
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
									{idx < currentStep ? <CheckCircle className="h-5 w-5" /> : <step.icon className="h-4 w-4" />}
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
				{currentStep === 0 && <DocumentCaptureStep defaultValues={data} onNext={handleDocument} />}
				{currentStep === 1 && (
					<SelfieCaptureStep defaultValues={data} onNext={handleSelfie} onBack={() => goTo(0)} />
				)}
				{currentStep === 2 && (
					<SubmitStep
						data={data}
						onIdentityChange={(values) => setData((d) => ({ ...d, ...values }))}
						onSubmit={handleSubmit}
						onBack={() => goTo(1)}
						onEdit={(step: number) => goTo(step)}
					/>
				)}
			</div>
		</div>
	);
}
