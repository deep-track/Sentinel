"use client";

import { useState } from "react";
import type { KYIIdentityData } from "@/backend/lib/kyi-types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "@/modules/shared/upload-fields";

type GovernmentIdType = KYIIdentityData["governmentIdType"];

interface KYIDocumentStepProps {
  defaultValues?: Partial<KYIIdentityData>;
  onSubmit: (data: KYIIdentityData) => void | Promise<void>;
  /** Saves the current uploads before going back. */
  onBack: (data: Partial<KYIIdentityData>) => void;
  isLoading?: boolean;
}

type Errors = Partial<Record<"governmentIdType" | "front" | "back" | "selfie", string>>;

// Images are compressed client-side, uploaded to UploadThing (the permanent
// https URL is what gets stored) and base64-encoded for the backend. No
// blob:/data: URL is ever persisted.
export function KYIDocumentStep({ defaultValues, onSubmit, onBack, isLoading }: KYIDocumentStepProps) {
  const [values, setValues] = useState<Partial<KYIIdentityData>>({ ...defaultValues });
  const [uploadingCount, setUploadingCount] = useState(0);
  const [errors, setErrors] = useState<Errors>({});

  const idType = values.governmentIdType;
  const isBackSideRequired = idType === "national_id" || idType === "driving_license";
  const uploading = uploadingCount > 0;

  function update(patch: Partial<KYIIdentityData>, clear?: keyof Errors) {
    setValues((prev) => ({ ...prev, ...patch }));
    if (clear) setErrors((prev) => ({ ...prev, [clear]: undefined }));
  }

  function trackUploading(busy: boolean) {
    setUploadingCount((count) => Math.max(0, count + (busy ? 1 : -1)));
  }

  function selectIdType(next: GovernmentIdType) {
    const twoSided = next === "national_id" || next === "driving_license";
    // Drop a previously captured back side when switching to a passport.
    update(
      twoSided ? { governmentIdType: next } : { governmentIdType: next, governmentIdBackUrl: undefined, governmentIdBackBase64: undefined },
      "governmentIdType",
    );
  }

  async function handleSubmit() {
    const next: Errors = {};
    if (!idType) next.governmentIdType = "Select a document type";
    if (!values.governmentIdUrl || !values.governmentIdBase64) next.front = "Upload the front of the document";
    if (isBackSideRequired && (!values.governmentIdBackUrl || !values.governmentIdBackBase64)) {
      next.back = "Upload the back of the document";
    }
    if (!values.selfieUrl || !values.selfieBase64) next.selfie = "Upload a selfie";
    setErrors(next);
    const { governmentIdUrl, governmentIdBase64, selfieUrl, selfieBase64 } = values;
    if (Object.keys(next).length > 0 || !idType || !governmentIdUrl || !governmentIdBase64 || !selfieUrl || !selfieBase64) {
      return;
    }

    await onSubmit({
      governmentIdType: idType,
      governmentIdUrl,
      governmentIdBase64,
      governmentIdBackUrl: isBackSideRequired ? values.governmentIdBackUrl : undefined,
      governmentIdBackBase64: isBackSideRequired ? values.governmentIdBackBase64 : undefined,
      selfieUrl,
      selfieBase64,
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Document Type</h3>
        <Label htmlFor="kyi-government-id-type">Select Government-Issued ID *</Label>
        <Select value={idType} onValueChange={(value) => selectIdType(value as GovernmentIdType)}>
          <SelectTrigger id="kyi-government-id-type" disabled={isLoading || uploading}>
            <SelectValue placeholder="Choose a document type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="passport">Passport</SelectItem>
            <SelectItem value="national_id">National ID Card</SelectItem>
            <SelectItem value="driving_license">Driving License</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {isBackSideRequired ? "You'll need to upload both front and back" : "Front side only required"}
        </p>
        {errors.governmentIdType ? <p className="text-sm text-red-600">{errors.governmentIdType}</p> : null}
      </div>

      {idType ? (
        <>
          <ImageUploadField
            label="Document front side"
            url={values.governmentIdUrl}
            onUploaded={(image) => update({ governmentIdUrl: image.url, governmentIdBase64: image.base64 }, "front")}
            onClear={() => update({ governmentIdUrl: undefined, governmentIdBase64: undefined })}
            onUploadingChange={trackUploading}
            disabled={isLoading}
            error={errors.front}
          />

          {isBackSideRequired ? (
            <ImageUploadField
              label="Document back side"
              url={values.governmentIdBackUrl}
              onUploaded={(image) => update({ governmentIdBackUrl: image.url, governmentIdBackBase64: image.base64 }, "back")}
              onClear={() => update({ governmentIdBackUrl: undefined, governmentIdBackBase64: undefined })}
              onUploadingChange={trackUploading}
              disabled={isLoading}
              error={errors.back}
            />
          ) : null}

          <ImageUploadField
            label="Selfie"
            description="A clear selfie to match against the identity document."
            url={values.selfieUrl}
            onUploaded={(image) => update({ selfieUrl: image.url, selfieBase64: image.base64 }, "selfie")}
            onClear={() => update({ selfieUrl: undefined, selfieBase64: undefined })}
            onUploadingChange={trackUploading}
            disabled={isLoading}
            error={errors.selfie}
          />
        </>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={() => onBack(values)} disabled={isLoading || uploading}>
          Back
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={isLoading || uploading}>
          {uploading ? "Uploading…" : isLoading ? "Processing..." : "Continue to Financial Documents"}
        </Button>
      </div>
    </div>
  );
}
