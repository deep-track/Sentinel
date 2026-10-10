"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { documentTypeLabels } from "@/backend/lib/kyb-types";
import {
	KYB_DOCUMENT_FIELDS,
	type KYBSubmittedDocumentType,
	type KYBUploadedDocument,
} from "@/modules/kyb/types";
import { DocumentUploadField } from "@/modules/shared/upload-fields";

interface DocumentsStepProps {
	initialData: KYBUploadedDocument[];
	onSubmit: (values: KYBUploadedDocument[]) => void;
	/** Saves the current uploads before going back so they aren't lost. */
	onBack: (values: KYBUploadedDocument[]) => void;
}

const DOCUMENT_DESCRIPTIONS: Record<KYBSubmittedDocumentType, string> = {
	incorporation_certificate: "Certificate of incorporation or business registration.",
	utility_bill: "Recent utility bill or bank statement showing the business address.",
};

// Only the documents kyb.createKyb accepts are collected; files the backend
// can't store aren't requested.
const REQUIRED_DOCUMENTS = Object.keys(KYB_DOCUMENT_FIELDS) as KYBSubmittedDocumentType[];

export function DocumentsStep({ initialData, onSubmit, onBack }: DocumentsStepProps) {
	const [documents, setDocuments] = useState<KYBUploadedDocument[]>(initialData);
	const [uploadingCount, setUploadingCount] = useState(0);
	const [error, setError] = useState<string | null>(null);

	function setDocument(type: KYBSubmittedDocumentType, document: KYBUploadedDocument | null) {
		setDocuments((prev) => {
			const others = prev.filter((doc) => doc.type !== type);
			return document ? [...others, document] : others;
		});
	}

	function handleSubmit() {
		const missing = REQUIRED_DOCUMENTS.filter((type) => !documents.some((doc) => doc.type === type));
		if (missing.length > 0) {
			setError(`Upload the ${missing.map((type) => documentTypeLabels[type].toLowerCase()).join(" and ")}.`);
			return;
		}
		setError(null);
		onSubmit(documents);
	}

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900 dark:text-white">Business Documents</h2>
				<p className="text-gray-500 text-sm mt-1">
					Upload the incorporation certificate and a proof of business address.
				</p>
			</div>

			<div className="space-y-4">
				{REQUIRED_DOCUMENTS.map((type) => {
					const uploaded = documents.find((doc) => doc.type === type);
					return (
						<div key={type} className="border rounded-lg p-4">
							<DocumentUploadField
								label={documentTypeLabels[type]}
								description={DOCUMENT_DESCRIPTIONS[type]}
								required
								url={uploaded?.url}
								fileName={uploaded?.fileName}
								onUploaded={(url, file) => {
									setDocument(type, { type, url, fileName: file.name, mimeType: file.type });
									setError(null);
								}}
								onClear={() => setDocument(type, null)}
								onUploadingChange={(busy) => setUploadingCount((count) => Math.max(0, count + (busy ? 1 : -1)))}
							/>
						</div>
					);
				})}
			</div>

			{error && <p className="text-sm text-red-500 mt-4">{error}</p>}

			<div className="flex justify-between pt-6">
				<Button type="button" variant="outline" onClick={() => onBack(documents)} disabled={uploadingCount > 0}>
					Back
				</Button>
				<Button
					type="button"
					onClick={handleSubmit}
					disabled={uploadingCount > 0}
					className="bg-violet-600 hover:bg-violet-700 text-white"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
