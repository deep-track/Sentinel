"use client";

import { submitKYB } from "@/actions/kyb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { countries, documentTypeLabels } from "@/lib/kyb-types";
import type { DocumentType, KYBStepData } from "@/lib/kyb-types";
import {
	AlertCircle,
	Building2,
	CheckCircle,
	Edit2,
	FileText,
	Loader2,
	Users,
} from "lucide-react";
import { useState } from "react";

interface ReviewStepProps {
	data: KYBStepData;
	onBack: () => void;
	onSubmitSuccess: (reference: string) => void;
}

export function ReviewStep({ data, onBack, onSubmitSuccess }: ReviewStepProps) {
	const [confirmation, setConfirmation] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const countryName = countries.find(
		(c) => c.code === data.businessInfo.country,
	)?.name;

	const handleSubmit = async () => {
		if (!confirmation) {
			setError("Please confirm the information is accurate before submitting.");
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			const result = await submitKYB({
				businessName: data.businessInfo.businessName,
				registrationNumber: data.businessInfo.registrationNumber,
				country: data.businessInfo.country,
				documents: data.documents,
				ubos: data.ubos.map((ubo) => ({
					firstName: ubo.firstName,
					lastName: ubo.lastName,
					dateOfBirth: ubo.dateOfBirth,
					email: ubo.email,
					position: ubo.position,
					shareholding: ubo.shareholding,
				})),
			});

			if (result.success && result.data) {
				onSubmitSuccess(result.data.reference);
			} else {
				setError(result.error || "Submission failed. Please try again.");
				setIsSubmitting(false);
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "An unexpected error occurred",
			);
			setIsSubmitting(false);
		}
	};

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900">Review & Submit</h2>
				<p className="text-gray-500 text-sm mt-1">
					Review all information before submitting
				</p>
			</div>

			<div className="space-y-6">
				<div className="border rounded-lg p-4">
					<div className="flex justify-between items-center mb-3">
						<div className="flex items-center gap-2">
							<Building2 className="w-5 h-5 text-gray-400" />
							<h3 className="font-medium">Business Information</h3>
						</div>
						<button
							type="button"
							onClick={onBack}
							className="text-sm text-primary hover:underline flex items-center gap-1"
							onClickCapture={() => {}}
						>
							<Edit2 className="w-3 h-3" />
							Edit
						</button>
					</div>
					<div className="space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-gray-500">Business Name</span>
							<span className="font-medium">
								{data.businessInfo.businessName}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-gray-500">Registration Number</span>
							<span className="font-medium">
								{data.businessInfo.registrationNumber}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-gray-500">Country</span>
							<span className="font-medium">
								{countryName || data.businessInfo.country}
							</span>
						</div>
					</div>
				</div>

				<div className="border rounded-lg p-4">
					<div className="flex justify-between items-center mb-3">
						<div className="flex items-center gap-2">
							<FileText className="w-5 h-5 text-gray-400" />
							<h3 className="font-medium">Business Documents</h3>
						</div>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{data.documents.map((doc) => (
							<div
								key={doc.type}
								className="flex items-center gap-2 text-sm bg-gray-50 rounded px-3 py-2"
							>
								<CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
								<span className="truncate">
									{documentTypeLabels[doc.type as DocumentType]}
								</span>
							</div>
						))}
					</div>
				</div>

				<div className="border rounded-lg p-4">
					<div className="flex justify-between items-center mb-3">
						<div className="flex items-center gap-2">
							<Users className="w-5 h-5 text-gray-400" />
							<h3 className="font-medium">
								UBOs & Directors ({data.ubos.length})
							</h3>
						</div>
					</div>
					<div className="space-y-3">
						{data.ubos.map((ubo, index) => (
							<div
								key={ubo.id}
								className="flex items-center gap-3 text-sm bg-gray-50 rounded px-3 py-2"
							>
								<div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-primary font-medium text-sm">
									{index + 1}
								</div>
								<div className="flex-1 min-w-0">
									<p className="font-medium truncate">
										{ubo.firstName} {ubo.lastName}
									</p>
									<p className="text-gray-500 text-xs truncate">{ubo.email}</p>
								</div>
								<div className="text-right">
									<p className="text-sm">
										{ubo.position === "director"
											? "Director"
											: ubo.position === "shareholder"
												? "Shareholder"
												: "Beneficial Owner"}
									</p>
									{ubo.shareholding && (
										<p className="text-xs text-gray-500">{ubo.shareholding}%</p>
									)}
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="border rounded-lg p-4 bg-gray-50">
					<div className="flex items-start gap-3">
						<Checkbox
							id="confirmation"
							checked={confirmation}
							onCheckedChange={(checked) => {
								setConfirmation(checked === true);
								if (checked) setError(null);
							}}
							className="mt-1"
						/>
						<Label
							htmlFor="confirmation"
							className="text-sm text-gray-700 cursor-pointer"
						>
							I confirm that all information provided is accurate and complete,
							and that I am authorised to submit this verification on behalf of
							the business.
						</Label>
					</div>
				</div>

				{error && (
					<div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
						<AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
						<p className="text-sm text-red-700">{error}</p>
					</div>
				)}

				<div className="flex justify-between pt-4">
					<Button
						type="button"
						variant="outline"
						onClick={onBack}
						disabled={isSubmitting}
					>
						Back
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={isSubmitting || !confirmation}
						className="min-w-[160px] bg-violet-600 hover:bg-violet-700 text-white"
					>
						{isSubmitting ? (
							<>
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								Submitting verification...
							</>
						) : (
							"Submit"
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
