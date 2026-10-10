"use client";

import { useId, useState } from "react";
import { CheckCircle2, FileText, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/backend/lib/utils";
import { useObjectUrl } from "@/hooks/use-object-url";
import {
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_INPUT_BYTES,
  type PreparedImage,
  formatBytes,
  prepareVerificationImage,
  uploadSupportingDocument,
  validateDocumentFile,
  validateImageFile,
} from "@/modules/shared/files";

type ImageUploadFieldProps = {
  label: string;
  description?: string;
  /** Uploaded (permanent) URL of the current image, if any. */
  url?: string | null;
  onUploaded: (image: PreparedImage) => void;
  onClear?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  error?: string | null;
};

/**
 * Picks an identity image, downscales/compresses it, uploads it to
 * UploadThing and returns { url, base64 }. Only the uploaded https URL is
 * reported to the parent; the local blob: preview is revoked automatically.
 */
export function ImageUploadField({
  label,
  description,
  url,
  onUploaded,
  onClear,
  onUploadingChange,
  disabled,
  error,
}: ImageUploadFieldProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const localPreview = useObjectUrl(file);
  const preview = localPreview ?? url ?? null;

  function setBusy(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    // Allow picking the same file again after an error.
    event.target.value = "";
    if (!selected) return;

    const problem = validateImageFile(selected);
    if (problem) {
      setLocalError(problem);
      return;
    }

    setLocalError(null);
    setFile(selected);
    setBusy(true);
    try {
      const prepared = await prepareVerificationImage(selected);
      onUploaded(prepared);
    } catch (cause) {
      setFile(null);
      setLocalError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const shownError = localError ?? error ?? null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {description ? <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-4 transition-colors",
          url && !uploading
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
            : shownError
              ? "border-red-300 dark:border-red-800"
              : "border-slate-300 dark:border-slate-600 hover:border-violet-400",
        )}
      >
        {preview ? (
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob:/UploadThing preview */}
            <img src={preview} alt={label} className="h-32 w-auto max-w-full rounded-md object-contain bg-white" />
            <div className="flex flex-1 flex-col items-center gap-2 sm:items-start">
              {uploading ? (
                <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" /> Optimising and uploading…
                </p>
              ) : url ? (
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Uploaded
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={disabled || uploading} asChild>
                  <label htmlFor={inputId} className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> Replace
                  </label>
                </Button>
                {onClear ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || uploading}
                    onClick={() => {
                      setFile(null);
                      setLocalError(null);
                      onClear();
                    }}
                  >
                    <X className="mr-2 h-4 w-4" /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <label htmlFor={inputId} className="flex cursor-pointer flex-col items-center justify-center gap-2 py-4 text-center">
            <ImageIcon className="h-6 w-6 text-slate-400" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Click to upload</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              JPG, PNG or WebP · up to {formatBytes(MAX_IMAGE_INPUT_BYTES)}
            </span>
          </label>
        )}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={IMAGE_ACCEPT}
          disabled={disabled || uploading}
          onChange={handleChange}
        />
      </div>
      {shownError ? <p className="text-sm text-red-600 dark:text-red-400">{shownError}</p> : null}
    </div>
  );
}

type DocumentUploadFieldProps = {
  label: string;
  description?: string;
  required?: boolean;
  /** Uploaded (permanent) URL, if any. */
  url?: string | null;
  fileName?: string | null;
  onUploaded: (url: string, file: File) => void;
  onClear: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  error?: string | null;
};

/** Uploads a PDF/image supporting document to UploadThing and reports its URL. */
export function DocumentUploadField({
  label,
  description,
  required,
  url,
  fileName,
  onUploaded,
  onClear,
  onUploadingChange,
  disabled,
  error,
}: DocumentUploadFieldProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const imagePreview = useObjectUrl(file && file.type.startsWith("image/") ? file : null);

  function setBusy(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;

    const problem = validateDocumentFile(selected);
    if (problem) {
      setLocalError(problem);
      return;
    }

    setLocalError(null);
    setFile(selected);
    setBusy(true);
    try {
      const uploadedUrl = await uploadSupportingDocument(selected);
      onUploaded(uploadedUrl, selected);
    } catch (cause) {
      setFile(null);
      setLocalError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const shownError = localError ?? error ?? null;
  const displayName = file?.name ?? fileName ?? (url ? "Uploaded document" : null);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}{" "}
          {required ? (
            <span className="text-red-500">*</span>
          ) : (
            <span className="text-xs font-normal text-slate-400">(Optional)</span>
          )}
        </p>
        {description ? <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>

      {url || uploading ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview
            <img src={imagePreview} alt={displayName ?? label} className="h-12 w-12 rounded object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded bg-blue-100 dark:bg-blue-900/30">
              <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{displayName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {uploading ? "Uploading…" : "Uploaded"}
            </p>
          </div>
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          ) : (
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`Remove ${label}`}
                onClick={() => {
                  setFile(null);
                  setLocalError(null);
                  onClear();
                }}
              >
                <X className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={cn(
            "flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50",
            shownError ? "border-red-300 dark:border-red-800" : "border-slate-300 dark:border-slate-600",
          )}
        >
          <Upload className="h-6 w-6 text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-300">Click to upload</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            PDF, JPG or PNG · up to {formatBytes(MAX_DOCUMENT_BYTES)}
          </span>
        </label>
      )}
      <input
        id={inputId}
        type="file"
        className="sr-only"
        accept={DOCUMENT_ACCEPT}
        disabled={disabled || uploading}
        onChange={handleChange}
      />
      {shownError ? <p className="text-sm text-red-600 dark:text-red-400">{shownError}</p> : null}
    </div>
  );
}
