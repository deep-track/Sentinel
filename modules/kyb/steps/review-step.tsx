"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import {
	AlertCircle,
	Building2,
	CheckCircle,
	Edit2,
	FileText,
	Loader2,
	Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { countries, documentTypeLabels } from "@/backend/lib/kyb-types";
import type { DocumentType } from "@/backend/lib/kyb-types";
import { KYB_DOCUMENT_FIELDS, type KYBWizardData } from "@/modules/kyb/types";
import { getErrorMessage } from "@/modules/shared/errors";

interface ReviewStepProps {
	clientId: string;
	data: KYBWizardData;
	onBack: () => void;
	onEdit: (step: number) => void;
	onSubmitSuccess: (result: { id: string; reference: string }) => void;
}

const POSITION_LABELS: Record<string, string> = {
	director: "Director",
	shareholder: "Shareholder",
	beneficial_owner: "Beneficial Owner",
};

export function ReviewStep({ clientId, data, onBack, onEdit, onSubmitSuccess }: ReviewStepProps) {
	const createKyb = useMutation(anyApi.kyb.createKyb);
	const [confirmation, setConfirmation] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const countryName = countries.find(
		(c) => c.code === data.businessInfo.country,
	)?.name;

	const documentUrl = (type: keyof typeof KYB_DOCUMENT_FIELDS) =>
		data.documents.find((doc) => doc.type === type)?.url ?? "";

	const handleSubmit = async () => {
		if (!confirmation) {
			setError("Please confirm the information is accurate before submitting.");
			return;
		}

		const registrationDocUrl = documentUrl("incorporation_certificate");
		const proofOfAddressUrl = documentUrl("utility_bill");
		if (!registrationDocUrl || !proofOfAddressUrl) {
			setError("Upload the incorporation certificate and proof of address before submitting.");
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			const result: { id: string; reference: string } = await createKyb({
				clientId,
				businessName: data.businessInfo.businessName.trim(),
				registrationNumber: data.businessInfo.registrationNumber.trim(),
				incorporationCountry: data.businessInfo.country,
				registrationDocUrl,
				proofOfAddressUrl,
				directors: data.ubos.map((ubo) => ({
					firstName: ubo.firstName.trim(),
					lastName: ubo.lastName.trim(),
					email: ubo.email.trim(),
					position: ubo.position,
					shareholding: ubo.shareholding.trim() || undefined,
					dateOfBirth: ubo.dateOfBirth,
					idNumber: ubo.idNumber.trim(),
				})),
			});
			onSubmitSuccess(result);
		} catch (err) {
			setError(getErrorMessage(err, "Submission failed. Please try again."));
			setIsSubmitting(false);
		}
	};

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900 dark:text-white">Review & Submit</h2>
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
							onClick={() => onEdit(1)}
							className="text-sm text-primary hover:underline flex items-center gap-1"
						>
							<Edit2 className="w-3 h-3" />
							Edit
						</button>
					</div>
					<div className="space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-gray-500">Business Name</span>
							<span className="font-medium">{data.businessInfo.businessName}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-gray-500">Registration Number</span>
							<span className="font-medium">{data.businessInfo.registrationNumber}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-gray-500">Country of incorporation</span>
							<span className="font-medium">{countryName || data.businessInfo.country}</span>
						</div>
					</div>
				</div>

				<div className="border rounded-lg p-4">
					<div className="flex justify-between items-center mb-3">
						<div className="flex items-center gap-2">
							<FileText className="w-5 h-5 text-gray-400" />
							<h3 className="font-medium">Business Documents</h3>
						</div>
						<button
							type="button"
							onClick={() => onEdit(2)}
							className="text-sm text-primary hover:underline flex items-center gap-1"
						>
							<Edit2 className="w-3 h-3" />
							Edit
						</button>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{data.documents.map((doc) => (
							<div
								key={doc.type}
								className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-slate-800 rounded px-3 py-2"
							>
								<CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
								<span className="truncate">
									{documentTypeLabels[doc.type as DocumentType]} · {doc.fileName}
								</span>
							</div>
						))}
					</div>
				</div>

				<div className="border rounded-lg p-4">
					<div className="flex justify-between items-center mb-3">
						<div className="flex items-center gap-2">
							<Users className="w-5 h-5 text-gray-400" />
							<h3 className="font-medium">UBOs & Directors ({data.ubos.length})</h3>
						</div>
						<button
							type="button"
							onClick={() => onEdit(3)}
							className="text-sm text-primary hover:underline flex items-center gap-1"
						>
							<Edit2 className="w-3 h-3" />
							Edit
						</button>
					</div>
					<div className="space-y-3">
						{data.ubos.map((ubo, index) => (
							<div
								key={ubo.id}
								className="flex items-center gap-3 text-sm bg-gray-50 dark:bg-slate-800 rounded px-3 py-2"
							>
								<div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-primary font-medium text-sm">
									{index + 1}
								</div>
								<div className="flex-1 min-w-0">
									<p className="font-medium truncate">
										{ubo.firstName} {ubo.lastName}
									</p>
									<p className="text-gray-500 text-xs truncate">
										{ubo.email} · ID {ubo.idNumber}
									</p>
								</div>
								<div className="text-right">
									<p className="text-sm">{POSITION_LABELS[ubo.position] ?? ubo.position}</p>
									{ubo.shareholding && (
										<p className="text-xs text-gray-500">{ubo.shareholding}%</p>
									)}
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="border rounded-lg p-4 bg-gray-50 dark:bg-slate-800/50">
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
							className="text-sm text-gray-700 dark:text-slate-300 cursor-pointer"
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
						type="button"
						onClick={() => void handleSubmit()}
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
