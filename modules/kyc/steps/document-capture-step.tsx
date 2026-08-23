"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { kycSubmissionSchema, type KYCSubmissionData } from "@/backend/lib/kyc-types";
import { uploadFiles } from "@/backend/lib/uploadthing";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ArrowRight, Upload, Image as ImageIcon, Check } from "lucide-react";
import { cn } from "@/backend/lib/utils";
import { VerificationTips } from "@/modules/kyc/components/verification-tips";

interface DocumentCaptureStepProps {
  defaultValues?: Partial<KYCSubmissionData>;
  onNext: (data: Pick<KYCSubmissionData, "documentType" | "documentFrontUrl" | "documentBackUrl" | "documentFrontBase64" | "documentBackBase64">) => void;
}

const schema = kycSubmissionSchema.pick({
  documentType: true,
  documentFrontUrl: true,
  documentBackUrl: true,
  documentFrontBase64: true,
  documentBackBase64: true,
  selfieUrl: true,
  selfieBase64: true,
});

const DOCUMENT_TYPES = [
  { value: "passport", label: "Passport", description: "Single-page document", sides: 1 },
  { value: "id_card", label: "National ID", description: "Front and back required", sides: 2 },
  { value: "driving_license", label: "Driver's License", description: "Front and back required", sides: 2 },
] as const;

async function uploadAndEncode(file: File) {
  const [base64, uploaded] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }),
    uploadFiles("kycUploader", { files: [file] }),
  ]);

  const url = uploaded[0]?.ufsUrl ?? uploaded[0]?.url;
  if (!url) {
    throw new Error("Upload failed");
  }

  return { url, base64 };
}

export function DocumentCaptureStep({ defaultValues, onNext }: DocumentCaptureStepProps) {
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);

  const form = useForm<Pick<KYCSubmissionData, "documentType" | "documentFrontUrl" | "documentBackUrl" | "documentFrontBase64" | "documentBackBase64" | "selfieUrl" | "selfieBase64">>({
    resolver: zodResolver(schema),
    defaultValues: {
      documentType: defaultValues?.documentType,
      documentFrontUrl: defaultValues?.documentFrontUrl ?? "",
      documentBackUrl: defaultValues?.documentBackUrl ?? "",
      documentFrontBase64: defaultValues?.documentFrontBase64 ?? "",
      documentBackBase64: defaultValues?.documentBackBase64 ?? "",
      selfieUrl: defaultValues?.selfieUrl ?? "placeholder",
      selfieBase64: defaultValues?.selfieBase64 ?? "placeholder",
    },
  });

  const selectedDocType = form.watch("documentType");
  const requiresBackSide = selectedDocType && selectedDocType !== "passport";
  const frontUrl = form.watch("documentFrontUrl");
  const backUrl = form.watch("documentBackUrl");

  return (
    <Form {...form}>
      <form
        className="space-y-6"
        onSubmit={form.handleSubmit((values) =>
          onNext({
            documentType: values.documentType,
            documentFrontUrl: values.documentFrontUrl,
            documentBackUrl: values.documentBackUrl,
            documentFrontBase64: values.documentFrontBase64,
            documentBackBase64: values.documentBackBase64,
          }),
        )}
      >
        <VerificationTips type="document" />
        <FormField
          control={form.control}
          name="documentType"
          render={({ field }) => (
            <FormItem>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {DOCUMENT_TYPES.map((documentType) => (
                  <button
                    key={documentType.value}
                    type="button"
                    onClick={() => field.onChange(documentType.value)}
                    className={cn(
                      "rounded-lg border-2 p-4 text-left transition-all",
                      field.value === documentType.value
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
                    )}
                  >
                    <p className="font-medium text-sm">{documentType.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {documentType.description}
                    </p>
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {selectedDocType && (
          <>
            <FormField
              control={form.control}
              name="documentFrontUrl"
              render={({ field }) => (
                <FormItem>
                  <div className="space-y-2">
                    {requiresBackSide && (
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Step 1 of 2: Front Side
                      </p>
                    )}
                    <FormControl>
                      <div className={cn(
                        "rounded-lg border-2 border-dashed p-6 transition-colors",
                        field.value
                          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
                          : "border-slate-300 dark:border-slate-600 hover:border-violet-400"
                      )}>
                        <label className="flex items-center justify-center gap-3 cursor-pointer">
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/*,.pdf"
                            disabled={uploadingFront}
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              setUploadingFront(true);
                              try {
                                const result = await uploadAndEncode(file);
                                field.onChange(result.url);
                                form.setValue("documentFrontBase64", result.base64, { shouldValidate: true });
                              } catch {
                                form.setError("documentFrontUrl", { message: "Failed to upload front image" });
                              } finally {
                                setUploadingFront(false);
                              }
                            }}
                          />
                          <div className="text-center">
                            {field.value ? (
                              <>
                                <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                  Front image uploaded
                                </p>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                  Click to replace
                                </p>
                              </>
                            ) : (
                              <>
                                <ImageIcon className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                  {uploadingFront ? "Uploading front..." : "Upload front image"}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  PNG, JPG or PDF
                                </p>
                              </>
                            )}
                          </div>
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            {requiresBackSide && (
              <FormField
                control={form.control}
                name="documentBackUrl"
                render={({ field }) => (
                  <FormItem>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Step 2 of 2: Back Side
                      </p>
                      <FormControl>
                        <div className={cn(
                          "rounded-lg border-2 border-dashed p-6 transition-colors",
                          field.value
                            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
                            : "border-slate-300 dark:border-slate-600 hover:border-violet-400"
                        )}>
                          <label className="flex items-center justify-center gap-3 cursor-pointer">
                            <input
                              type="file"
                              className="sr-only"
                              accept="image/*,.pdf"
                              disabled={uploadingBack}
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                setUploadingBack(true);
                                try {
                                  const result = await uploadAndEncode(file);
                                  field.onChange(result.url);
                                  form.setValue("documentBackBase64", result.base64, { shouldValidate: true });
                                } catch {
                                  form.setError("documentBackUrl", { message: "Failed to upload back image" });
                                } finally {
                                  setUploadingBack(false);
                                }
                              }}
                            />
                            <div className="text-center">
                              {field.value ? (
                                <>
                                  <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                    Back image uploaded
                                  </p>
                                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                    Click to replace
                                  </p>
                                </>
                              ) : (
                                <>
                                  <ImageIcon className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                    {uploadingBack ? "Uploading back..." : "Upload back image"}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    PNG, JPG or PDF
                                  </p>
                                </>
                              )}
                            </div>
                          </label>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!selectedDocType || !frontUrl || (requiresBackSide && !backUrl)}
            className="bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
          >
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}
