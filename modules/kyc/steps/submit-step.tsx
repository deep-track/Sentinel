"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/backend/lib/utils";
import {
	type KYCIdentityData,
	type KYCWizardData,
	kycIdentitySchema,
	todayIsoDate,
} from "@/modules/kyc/types";

type IdentityField = keyof KYCIdentityData;
type IdentityErrors = Partial<Record<IdentityField, string>>;

interface SubmitStepProps {
	data: KYCWizardData;
	/** Persists in-progress identity fields in the wizard so Back/Edit keep them. */
	onIdentityChange: (values: Partial<Record<IdentityField, string>>) => void;
	onSubmit: (identity: KYCIdentityData) => Promise<void>;
	onBack: () => void;
	onEdit: (step: number) => void;
}

const DOCUMENT_LABELS: Record<string, string> = {
	passport: "Passport",
	id_card: "National ID",
	driving_license: "Driver's License",
};

const TEXT_FIELDS: { key: Exclude<IdentityField, "gender" | "dateOfBirth">; label: string; placeholder?: string; autoComplete?: string }[] = [
	{ key: "firstName", label: "First name", autoComplete: "off" },
	{ key: "lastName", label: "Last name", autoComplete: "off" },
	{ key: "idNumber", label: "ID / document number", placeholder: "e.g. A1234567", autoComplete: "off" },
];

const inputClass =
	"mt-2 w-full rounded-lg border bg-white p-2.5 text-sm dark:bg-slate-950";

export function SubmitStep({ data, onIdentityChange, onSubmit, onBack, onEdit }: SubmitStepProps) {
	const [consent, setConsent] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [errors, setErrors] = useState<IdentityErrors>({});

	function setField(key: IdentityField, value: string) {
		onIdentityChange({ [key]: value });
		if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
	}

	function validateField(key: IdentityField) {
		const result = kycIdentitySchema.shape[key].safeParse(data[key] ?? "");
		setErrors((prev) => ({ ...prev, [key]: result.success ? undefined : result.error.issues[0]?.message }));
	}

	async function handleSubmit() {
		const parsed = kycIdentitySchema.safeParse({
			firstName: data.firstName ?? "",
			lastName: data.lastName ?? "",
			idNumber: data.idNumber ?? "",
			dateOfBirth: data.dateOfBirth ?? "",
			gender: data.gender ?? "",
		});
		if (!parsed.success) {
			const next: IdentityErrors = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0] as IdentityField;
				if (!next[key]) next[key] = issue.message;
			}
			setErrors(next);
			return;
		}
		setErrors({});
		setSubmitting(true);
		try {
			await onSubmit(parsed.data);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<div>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-white">Identity details</h3>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						Enter the details exactly as they appear on the document.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					{TEXT_FIELDS.map(({ key, label, placeholder, autoComplete }) => (
						<label key={key} className="text-sm font-medium text-slate-700 dark:text-slate-300">
							{label}
							<input
								value={data[key] ?? ""}
								placeholder={placeholder}
								autoComplete={autoComplete}
								onChange={(event) => setField(key, event.target.value)}
								onBlur={() => data[key] && validateField(key)}
								aria-invalid={Boolean(errors[key])}
								className={cn(inputClass, errors[key] ? "border-red-500" : "border-slate-300 dark:border-slate-700")}
							/>
							{errors[key] ? <span className="mt-1 block text-xs font-normal text-red-600">{errors[key]}</span> : null}
						</label>
					))}
					<label className="text-sm font-medium text-slate-700 dark:text-slate-300">
						Date of birth
						<input
							type="date"
							value={data.dateOfBirth ?? ""}
							max={todayIsoDate()}
							min="1900-01-01"
							onChange={(event) => setField("dateOfBirth", event.target.value)}
							onBlur={() => data.dateOfBirth && validateField("dateOfBirth")}
							aria-invalid={Boolean(errors.dateOfBirth)}
							className={cn(inputClass, errors.dateOfBirth ? "border-red-500" : "border-slate-300 dark:border-slate-700")}
						/>
						{errors.dateOfBirth ? (
							<span className="mt-1 block text-xs font-normal text-red-600">{errors.dateOfBirth}</span>
						) : null}
					</label>
					<label className="text-sm font-medium text-slate-700 dark:text-slate-300">
						Gender
						<select
							value={data.gender ?? ""}
							onChange={(event) => setField("gender", event.target.value)}
							aria-invalid={Boolean(errors.gender)}
							className={cn(inputClass, errors.gender ? "border-red-500" : "border-slate-300 dark:border-slate-700")}
						>
							<option value="">Select gender</option>
							<option value="male">Male</option>
							<option value="female">Female</option>
							<option value="other">Other</option>
						</select>
						{errors.gender ? <span className="mt-1 block text-xs font-normal text-red-600">{errors.gender}</span> : null}
					</label>
				</div>
			</div>

			<div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2">
				<p className="text-sm">
					<strong>Document type:</strong> {data.documentType ? DOCUMENT_LABELS[data.documentType] : "—"}
				</p>
				<p className="text-sm">
					<strong>Document front:</strong> {data.documentFrontUrl ? "Uploaded" : "Missing"}
				</p>
				{data.documentType && data.documentType !== "passport" ? (
					<p className="text-sm">
						<strong>Document back:</strong> {data.documentBackUrl ? "Uploaded" : "Missing"}
					</p>
				) : null}
				<p className="text-sm">
					<strong>Selfie:</strong> {data.selfieUrl ? "Uploaded" : "Missing"}
				</p>
				<p className="text-sm">
					<strong>Liveness:</strong> Not collected in this flow
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
					onClick={() => void handleSubmit()}
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
