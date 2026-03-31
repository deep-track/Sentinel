"use client";

import { Button } from "@/components/ui/button";
import { type KYCSubmissionData } from "@/lib/kyc-types";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useState } from "react";

interface SubmitStepProps {
	data: Partial<KYCSubmissionData>;
	onSubmit: () => Promise<void>;
	onBack: () => void;
	onEdit: (step: number) => void;
}

export function SubmitStep({
	data,
	onSubmit,
	onBack,
	onEdit,
}: SubmitStepProps) {
	const [consent, setConsent] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	return (
		<div className="space-y-6">
			<div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2">
				<p className="text-sm">
					<strong>Document type:</strong> {data.documentType ?? "—"}
				</p>
				<p className="text-sm">
					<strong>Document front:</strong>{" "}
					{data.documentFrontUrl ? "Uploaded" : "Missing"}
				</p>
				<p className="text-sm">
					<strong>Selfie:</strong> {data.selfieUrl ? "Uploaded" : "Missing"}
				</p>
				<button
					type="button"
					className="text-xs text-violet-600 hover:underline"
					onClick={() => onEdit(0)}
				>
					Edit captures
				</button>
			</div>

			<label className="flex items-start gap-3">
				<input
					type="checkbox"
					checked={consent}
					onChange={(event) => setConsent(event.target.checked)}
					className="mt-0.5 h-4 w-4"
				/>
				<span className="text-sm text-slate-700 dark:text-slate-300">
					I confirm submitted images are authentic and consent to automated
					extraction and verification.
				</span>
			</label>

			<div className="flex justify-between">
				<Button
					type="button"
					variant="outline"
					onClick={onBack}
					disabled={submitting}
				>
					<ArrowLeft className="mr-2 h-4 w-4" /> Back
				</Button>
				<Button
					type="button"
					disabled={!consent || submitting}
					className="bg-violet-600 hover:bg-violet-700 text-white"
					onClick={async () => {
						setSubmitting(true);
						try {
							await onSubmit();
						} finally {
							setSubmitting(false);
						}
					}}
				>
					{submitting ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Submitting Verification...
						</>
					) : (
						<>
							<Send className="mr-2 h-4 w-4" /> Submit Verification
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
