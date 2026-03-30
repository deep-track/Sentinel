"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	type DocumentType,
	type UploadedDocument,
	documentTypeLabels,
	documentTypes,
} from "@/lib/kyb-types";
import { cn } from "@/lib/utils";
import {
	CheckCircle,
	FileText,
	Image as ImageIcon,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

interface DocumentsStepProps {
	initialData: UploadedDocument[];
	onSubmit: (values: UploadedDocument[]) => void;
	onBack: () => void;
}

const MAX_FILE_SIZE = 16 * 1024 * 1024;

export function DocumentsStep({
	initialData,
	onSubmit,
	onBack,
}: DocumentsStepProps) {
	const [documents, setDocuments] = useState<UploadedDocument[]>(initialData);
	const [error, setError] = useState<string | null>(null);

	const handleFileSelect = useCallback(
		(documentType: DocumentType, file: File) => {
			if (file.size > MAX_FILE_SIZE) {
				toast.error(
					`${documentTypeLabels[documentType]}: File size exceeds 16MB`,
				);
				return;
			}

			const reader = new FileReader();
			reader.onload = (e) => {
				const base64 = e.target?.result as string;
				const newDoc: UploadedDocument = {
					type: documentType,
					fileName: file.name,
					mimeType: file.type,
					base64,
					preview: file.type.startsWith("image/") ? base64 : undefined,
				};

				setDocuments((prev) => {
					const filtered = prev.filter((d) => d.type !== documentType);
					return [...filtered, newDoc];
				});
			};
			reader.readAsDataURL(file);
		},
		[],
	);

	const handleRemove = (documentType: DocumentType) => {
		setDocuments((prev) => prev.filter((d) => d.type !== documentType));
	};

	const handleSubmit = () => {
		const missingDocs = documentTypes.filter(
			(type) => !documents.find((d) => d.type === type),
		);

		if (missingDocs.length > 0) {
			setError("Please upload all required documents before proceeding.");
			return;
		}

		setError(null);
		onSubmit(documents);
	};

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900">
					Business Documents
				</h2>
				<p className="text-gray-500 text-sm mt-1">
					Upload the required business documents for verification
				</p>
			</div>

			<div className="space-y-4">
				{documentTypes.map((docType) => {
					const uploadedDoc = documents.find((d) => d.type === docType);
					const isImage = uploadedDoc?.mimeType?.startsWith("image/");
					const isPDF = uploadedDoc?.mimeType === "application/pdf";

					return (
						<div key={docType} className="border rounded-lg p-4">
							<Label className="text-sm font-medium">
								{documentTypeLabels[docType]}{" "}
								<span className="text-red-500">*</span>
							</Label>
							<p className="text-xs text-gray-500 mb-3">
								Accepted formats: JPG, JPEG, PNG, PDF — Maximum 16MB
							</p>

							{uploadedDoc ? (
								<div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
									{isImage && uploadedDoc.preview ? (
										<img
											src={uploadedDoc.preview}
											alt={uploadedDoc.fileName}
											className="w-12 h-12 object-cover rounded"
										/>
									) : (
										<div className="w-12 h-12 bg-blue-100 rounded flex items-center justify-center">
											<FileText className="w-6 h-6 text-blue-600" />
										</div>
									)}
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-gray-900 truncate">
											{uploadedDoc.fileName}
										</p>
										<p className="text-xs text-gray-500">
											{isImage ? "Image" : isPDF ? "PDF" : "Document"}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<CheckCircle className="w-5 h-5 text-green-600" />
										<button
											type="button"
											onClick={() => handleRemove(docType)}
											className="p-1 hover:bg-red-100 rounded"
										>
											<X className="w-5 h-5 text-red-500" />
										</button>
									</div>
								</div>
							) : (
								<label
									className={cn(
										"flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 transition-colors",
										"border-gray-300",
									)}
								>
									<div className="flex flex-col items-center justify-center pt-5 pb-6">
										<Upload className="w-8 h-8 text-gray-400 mb-2" />
										<p className="text-sm text-gray-500">
											Click to upload or drag and drop
										</p>
									</div>
									<input
										type="file"
										className="hidden"
										accept=".jpg,.jpeg,.png,.pdf"
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) handleFileSelect(docType, file);
										}}
									/>
								</label>
							)}
						</div>
					);
				})}
			</div>

			{error && <p className="text-sm text-red-500 mt-4">{error}</p>}

			<div className="flex justify-between pt-6">
				<Button type="button" variant="outline" onClick={onBack}>
					Back
				</Button>
				<Button
					onClick={handleSubmit}
					className="bg-violet-600 hover:bg-violet-700 text-white"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
