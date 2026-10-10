"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/backend/lib/utils";
import { BusinessInfoStep } from "@/modules/kyb/steps/business-info-step";
import { DocumentsStep } from "@/modules/kyb/steps/documents-step";
import { ReviewStep } from "@/modules/kyb/steps/review-step";
import { UBODirectorsStep } from "@/modules/kyb/steps/ubo-directors-step";
import { type KYBWizardData, createInitialWizardData } from "@/modules/kyb/types";
import {
	Building2,
	CheckCircle,
	ClipboardCheck,
	FileText,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STEPS = [
	{ id: 1, title: "Business Info", icon: Building2 },
	{ id: 2, title: "Business Documents", icon: FileText },
	{ id: 3, title: "UBO & Directors", icon: Users },
	{ id: 4, title: "Review & Submit", icon: ClipboardCheck },
];

interface KYBWizardProps {
	clientId: string;
	onComplete?: (reference: string) => void;
}

export function KYBWizard({ clientId, onComplete }: KYBWizardProps) {
	const [currentStep, setCurrentStep] = useState(1);
	const [data, setData] = useState<KYBWizardData>(createInitialWizardData);
	const [submitted, setSubmitted] = useState<{ id: string; reference: string } | null>(null);

	function updateData(updates: Partial<KYBWizardData>) {
		setData((prev) => ({ ...prev, ...updates }));
	}

	function goTo(step: number) {
		setCurrentStep(step);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	function handleBusinessInfoSubmit(values: KYBWizardData["businessInfo"]) {
		updateData({ businessInfo: values });
		goTo(2);
	}

	function handleDocumentsSubmit(values: KYBWizardData["documents"]) {
		updateData({ documents: values });
		goTo(3);
	}

	function handleUBOSubmit(values: KYBWizardData["ubos"]) {
		updateData({ ubos: values });
		goTo(4);
	}

	function handleSubmitSuccess(result: { id: string; reference: string }) {
		setSubmitted(result);
		onComplete?.(result.reference);
	}

	function goBack() {
		if (currentStep > 1) goTo(currentStep - 1);
	}

	if (submitted) {
		return (
			<div className="max-w-3xl mx-auto">
				<div className="bg-white rounded-2xl shadow-sm border p-8 text-center">
					<div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
						<CheckCircle className="w-10 h-10 text-green-600" />
					</div>
					<h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
						Submission Received
					</h2>
					<p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
						The KYB submission has been received and routed to our compliance
						team for document and UBO review. You can track its status on the
						verification page.
					</p>
					<p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
						Reference:{" "}
						<span className="font-mono font-medium">{submitted.reference}</span>
					</p>
					<div className="flex flex-wrap justify-center gap-2">
						<Button
							asChild
							className="bg-violet-600 hover:bg-violet-700 text-white"
						>
							<Link href={`/kyb/${submitted.id}`}>View verification</Link>
						</Button>
						<Button asChild variant="outline">
							<Link href="/kyb">Back to KYB</Link>
						</Button>
					</div>
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-4">
						Redirecting to the verification in 5 seconds...
					</p>
				</div>
				<AutoRedirect href={`/kyb/${submitted.id}`} />
			</div>
		);
	}

	return (
		<div className="max-w-3xl mx-auto">
			<div className="mb-8">
				<div className="flex items-center justify-between">
					{STEPS.map((step, index) => {
						const isCompleted = currentStep > step.id;
						const isCurrent = currentStep === step.id;
						const Icon = step.icon;

						return (
							<div key={step.id} className="flex items-center">
								<div className="flex flex-col items-center">
									<div
										className={cn(
											"w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-200",
											isCompleted
												? "bg-violet-600 border-violet-600 text-white"
												: isCurrent
													? "border-violet-600 text-violet-600 bg-white dark:bg-slate-900"
													: "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-400",
										)}
									>
										{isCompleted ? (
											<CheckCircle className="w-5 h-5" />
										) : (
											<Icon className="w-5 h-5" />
										)}
									</div>
									<span
										className={cn(
											"text-xs mt-2 font-medium hidden sm:block",
											isCompleted
												? "text-violet-500"
												: isCurrent
													? "text-violet-600 dark:text-violet-400"
													: "text-slate-400 dark:text-slate-500",
										)}
									>
										{step.title}
									</span>
								</div>
								{index < STEPS.length - 1 && (
									<div
										className={cn(
											"w-12 sm:w-20 h-0.5 mx-2 transition-all duration-300",
											currentStep > step.id
												? "bg-violet-500"
												: "bg-slate-200 dark:bg-slate-700",
										)}
									/>
								)}
							</div>
						);
					})}
				</div>
			</div>

			<div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border p-6 sm:p-8">
				{currentStep === 1 && (
					<BusinessInfoStep
						initialData={data.businessInfo}
						onSubmit={handleBusinessInfoSubmit}
					/>
				)}
				{currentStep === 2 && (
					<DocumentsStep
						initialData={data.documents}
						onSubmit={handleDocumentsSubmit}
						onBack={(documents) => {
							updateData({ documents });
							goBack();
						}}
					/>
				)}
				{currentStep === 3 && (
					<UBODirectorsStep
						initialData={data.ubos}
						onSubmit={handleUBOSubmit}
						onBack={(ubos) => {
							updateData({ ubos });
							goBack();
						}}
					/>
				)}
				{currentStep === 4 && (
					<ReviewStep
						clientId={clientId}
						data={data}
						onBack={goBack}
						onEdit={goTo}
						onSubmitSuccess={handleSubmitSuccess}
					/>
				)}
			</div>
		</div>
	);
}

function AutoRedirect({ href, delayMs = 5000 }: { href: string; delayMs?: number }) {
	const router = useRouter();
	useEffect(() => {
		const timer = setTimeout(() => router.push(href), delayMs);
		return () => clearTimeout(timer);
	}, [router, href, delayMs]);
	return null;
}
