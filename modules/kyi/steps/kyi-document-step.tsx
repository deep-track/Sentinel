"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { kyiIdentitySchema, KYIIdentityData } from "@/lib/kyi-types";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface KYIDocumentStepProps {
  defaultValues?: Partial<KYIIdentityData>;
  onSubmit: (data: KYIIdentityData) => void | Promise<void>;
  isLoading?: boolean;
}

export function KYIDocumentStep({
  defaultValues,
  onSubmit,
  isLoading,
}: KYIDocumentStepProps) {
  const [governmentIdType, setGovernmentIdType] = useState<string>(
    defaultValues?.governmentIdType || ""
  );
  const [governmentIdImage, setGovernmentIdImage] = useState<string | null>(
    defaultValues?.governmentIdUrl || null
  );
  const [governmentIdBackImage, setGovernmentIdBackImage] = useState<string | null>(
    defaultValues?.governmentIdBackUrl || null
  );
  const [selfieImage, setSelfieImage] = useState<string | null>(
    defaultValues?.selfieUrl || null
  );

  const form = useForm<KYIIdentityData>({
    resolver: zodResolver(kyiIdentitySchema),
    defaultValues: {
      ...defaultValues,
    },
  });

  // Check if back side is required
  const isBackSideRequired = ["national_id", "driving_license"].includes(governmentIdType);

  // Convert file to base64
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // Remove data:image/...;base64, prefix
      };
      reader.onerror = reject;
    });
  }, []);

  // Handle government ID upload
  const handleGovernmentIdUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const preview = URL.createObjectURL(file);
        setGovernmentIdImage(preview);

        const base64 = await fileToBase64(file);
        form.setValue("governmentIdBase64", base64);
        form.setValue("governmentIdUrl", preview);
      } catch (error) {
        console.error("Failed to process image:", error);
      }
    },
    [fileToBase64, form]
  );

  // Handle government ID back upload
  const handleGovernmentIdBackUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const preview = URL.createObjectURL(file);
        setGovernmentIdBackImage(preview);

        const base64 = await fileToBase64(file);
        form.setValue("governmentIdBackBase64", base64);
        form.setValue("governmentIdBackUrl", preview);
      } catch (error) {
        console.error("Failed to process image:", error);
      }
    },
    [fileToBase64, form]
  );

  // Handle selfie upload
  const handleSelfieUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const preview = URL.createObjectURL(file);
        setSelfieImage(preview);

        const base64 = await fileToBase64(file);
        form.setValue("selfieBase64", base64);
        form.setValue("selfieUrl", preview);
      } catch (error) {
        console.error("Failed to process image:", error);
      }
    },
    [fileToBase64, form]
  );

  async function handleSubmit(data: KYIIdentityData) {
    await onSubmit(data);
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          We use Shufti Pro's AI-powered verification to ensure your documents are genuine
          and match your identity.
        </AlertDescription>
      </Alert>

      {/* Document Type Selection */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Document Type</h3>
        </div>

        <FormField
          control={form.control}
          name="governmentIdType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Select Government-Issued ID *</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  setGovernmentIdType(value);
                }}
              >
                <FormControl>
                  <SelectTrigger disabled={isLoading}>
                    <SelectValue placeholder="Choose a document type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="national_id">National ID Card</SelectItem>
                  <SelectItem value="driving_license">Driving License</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {isBackSideRequired
                  ? "You'll need to upload both front and back"
                  : "Front side only required"}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Government ID Upload */}
      {governmentIdType && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-4">Document Front Side</h3>
          </div>

          <Card className="p-6 border-2 border-dashed">
            {governmentIdImage ? (
              <div className="space-y-4">
                <img
                  src={governmentIdImage}
                  alt="Government ID front"
                  className="max-h-64 rounded-lg object-cover"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGovernmentIdImage(null);
                    form.setValue("governmentIdBase64", "");
                    form.setValue("governmentIdUrl", "");
                  }}
                >
                  <X className="mr-2 h-4 w-4" />
                  Remove Photo
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-4 cursor-pointer py-8">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Click to upload front side</p>
                  <p className="text-sm text-muted-foreground">
                    JPG, PNG (max 10MB)
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleGovernmentIdUpload}
                  disabled={isLoading}
                  className="hidden"
                />
              </label>
            )}
          </Card>
          <FormMessage>
            {form.formState.errors.governmentIdBase64?.message}
          </FormMessage>
        </div>
      )}

      {/* Government ID Back Upload */}
      {isBackSideRequired && governmentIdType && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-4">Document Back Side</h3>
          </div>

          <Card className="p-6 border-2 border-dashed">
            {governmentIdBackImage ? (
              <div className="space-y-4">
                <img
                  src={governmentIdBackImage}
                  alt="Government ID back"
                  className="max-h-64 rounded-lg object-cover"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGovernmentIdBackImage(null);
                    form.setValue("governmentIdBackBase64", "");
                    form.setValue("governmentIdBackUrl", "");
                  }}
                >
                  <X className="mr-2 h-4 w-4" />
                  Remove Photo
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-4 cursor-pointer py-8">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Click to upload back side</p>
                  <p className="text-sm text-muted-foreground">
                    JPG, PNG (max 10MB)
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleGovernmentIdBackUpload}
                  disabled={isLoading}
                  className="hidden"
                />
              </label>
            )}
          </Card>
          <FormMessage>
            {form.formState.errors.governmentIdBackBase64?.message}
          </FormMessage>
        </div>
      )}

      {/* Selfie Upload */}
      {governmentIdType && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-4">Selfie Verification</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Take a clear selfie to match your identity document
            </p>
          </div>

          <Card className="p-6 border-2 border-dashed">
            {selfieImage ? (
              <div className="space-y-4">
                <img
                  src={selfieImage}
                  alt="Selfie"
                  className="max-h-64 rounded-lg object-cover"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelfieImage(null);
                    form.setValue("selfieBase64", "");
                    form.setValue("selfieUrl", "");
                  }}
                >
                  <X className="mr-2 h-4 w-4" />
                  Remove Photo
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-4 cursor-pointer py-8">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Click to upload selfie</p>
                  <p className="text-sm text-muted-foreground">
                    JPG, PNG (max 10MB)
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleSelfieUpload}
                  disabled={isLoading}
                  className="hidden"
                />
              </label>
            )}
          </Card>
          <FormMessage>{form.formState.errors.selfieBase64?.message}</FormMessage>
        </div>
      )}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Processing..." : "Continue to Financial Documents"}
      </Button>
    </form>
  );
}
