"use client";

import { getKYCRecord, submitKYC } from "@/actions/kyc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KYCStatus, KYCSubmissionData } from "@/lib/kyc-types";
import { getRemediationSummary } from "@/lib/shufti-decline-codes";
import { cn } from "@/lib/utils";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";
import { DocumentCaptureStep } from "@/modules/kyc/steps/document-capture-step";
import { SelfieCaptureStep } from "@/modules/kyc/steps/selfie-capture-step";
import { SubmitStep } from "@/modules/kyc/steps/submit-step";
import {
	AlertCircle,
	AlertTriangle,
	Camera,
	CheckCircle,
	ClipboardCheck,
	FileText,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface KYCWizardProps {
	invitationToken?: string;
	prefillEmail?: string;
}

const STEPS = [
	{ id: 0, title: "Document Capture", icon: FileText, shortTitle: "Document" },
	{ id: 1, title: "Selfie Capture", icon: Camera, shortTitle: "Selfie" },
	{
		id: 2,
		title: "Review & Submit",
		icon: ClipboardCheck,
		shortTitle: "Submit",
	},
];

export function KYCWizard({ invitationToken }: KYCWizardProps) {
	const [currentStep, setCurrentStep] = useState(0);
	const [data, setData] = useState<Partial<KYCSubmissionData>>({});
	const [submittedKycId, setSubmittedKycId] = useState<string | null>(null);
	const [submittedRef, setSubmittedRef] = useState<string | null>(null);
	const [completed, setCompleted] = useState(false);
	const [liveStatus, setLiveStatus] = useState<KYCStatus>("processing");
	const [declineInfo, setDeclineInfo] = useState<{
		codes: string[];
		summary: string;
		steps: string[];
		primaryIssue: string;
	} | null>(null);
	const pollRef = useRef<NodeJS.Timeout | null>(null);

	function handleDocument(
		values: Pick<
			KYCSubmissionData,
			| "documentType"
			| "documentFrontUrl"
			| "documentBackUrl"
			| "documentFrontBase64"
			| "documentBackBase64"
		>,
	) {
		setData((d) => ({ ...d, ...values }));
		setCurrentStep(1);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	function handleSelfie(
		values: Pick<KYCSubmissionData, "selfieUrl" | "selfieBase64">,
	) {
		setData((d) => ({ ...d, ...values }));
		setCurrentStep(2);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	async function handleSubmit() {
		if (
			!data.documentType ||
			!data.documentFrontUrl ||
			!data.documentFrontBase64 ||
			!data.selfieUrl ||
			!data.selfieBase64
		) {
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
			invitationToken,
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

		pollRef.current = setInterval(async () => {
			const result = await getKYCRecord(submittedKycId);
			if (!result.success || !result.data) return;

			setLiveStatus(result.data.status);

			// If declined, extract and process decline information
			if (
				result.data.status === "declined" &&
				result.data.declinedCodes &&
				result.data.declinedCodes.length > 0
			) {
				const remediation = getRemediationSummary(result.data.declinedCodes);
				setDeclineInfo({
					codes: result.data.declinedCodes as string[],
					summary: remediation.summary,
					steps: remediation.steps,
					primaryIssue: remediation.primaryIssue,
				});
			}

			if (["approved", "declined", "expired"].includes(result.data.status)) {
				if (pollRef.current) clearInterval(pollRef.current);
			}
		}, 3000);

		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [completed, submittedKycId]);

	if (completed) {
		// Declined verification screen
		if (liveStatus === "declined" && declineInfo) {
			return (
				<div className="space-y-6">
					<div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-8 text-center space-y-4">
						<div className="mx-auto h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
							<AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400" />
						</div>
						<h2 className="text-xl font-bold text-red-900 dark:text-red-100">
							Verification Declined
						</h2>
						<p className="text-sm text-red-800 dark:text-red-200">
							Reference:{" "}
							<code className="font-mono bg-red-100 dark:bg-red-900/50 px-2 py-1 rounded">
								{submittedRef}
							</code>
						</p>
					</div>

					<Card className="border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4">
						<h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
							<AlertCircle className="h-5 w-5 text-red-600" />
							Issue Found: {declineInfo.primaryIssue}
						</h3>
						<p className="text-sm text-slate-600 dark:text-slate-400">
							{declineInfo.summary}
						</p>

						{declineInfo.steps.length > 0 && (
							<div className="space-y-3 pt-4">
								<h4 className="font-medium text-slate-900 dark:text-white text-sm">
									How to Fix:
								</h4>
								<ol className="space-y-2">
									{declineInfo.steps.map((step, idx) => (
										<li
											key={idx}
											className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"
										>
											<span className="font-semibold text-violet-600 dark:text-violet-400 min-w-6">
												{idx + 1}.
											</span>
											<span>{step}</span>
										</li>
									))}
								</ol>
							</div>
						)}
					</Card>

					<div className="flex flex-col sm:flex-row gap-3 justify-center sm:justify-start">
						<Button
							onClick={() => {
								setCompleted(false);
								setCurrentStep(0);
								setData({});
								setDeclineInfo(null);
							}}
							className="bg-violet-600 hover:bg-violet-700 text-white"
						>
							Try Again
						</Button>
						<Button asChild variant="outline">
							<Link href="/kyc">Back to Dashboard</Link>
						</Button>
					</div>
				</div>
			);
		}

		// Default completed screen (processing/approved)
		// Don't show declined badge until we have the reason
		return (
			<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
				<div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
					<CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
				</div>
				<h2 className="text-xl font-bold text-slate-900 dark:text-white">
					Verification Submitted
				</h2>
				<p className="text-sm text-slate-500 dark:text-slate-400">
					Reference: <code className="font-mono">{submittedRef}</code>
				</p>
				<p className="text-sm text-slate-500 dark:text-slate-400">
					We are verifying your documents. This page updates automatically.
				</p>
				{liveStatus !== "declined" && (
					<div className="flex justify-center">
						<KYCStatusBadge status={liveStatus} />
					</div>
				)}
				<div className="pt-2">
					<Button
						asChild
						className="bg-violet-600 hover:bg-violet-700 text-white"
					>
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
						<div
							key={step.id}
							className="flex items-center flex-1 last:flex-none"
						>
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
											idx < currentStep
												? "bg-violet-500"
												: "bg-slate-200 dark:bg-slate-700",
										)}
									/>
								</div>
							)}
						</div>
					))}
				</div>
			</div>

			<div className="mb-6">
				<h2 className="text-xl font-bold text-slate-900 dark:text-white">
					{STEPS[currentStep].title}
				</h2>
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
