"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { financialDocsSchema, FinancialDocsData } from "@/lib/kyi-types";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Upload, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FinancialDocsStepProps {
  defaultValues?: Partial<FinancialDocsData>;
  onSubmit: (data: FinancialDocsData) => void | Promise<void>;
  isLoading?: boolean;
  investorType?: string;
}

const REQUIRED_DOCS = [
  { key: "bankStatementUrl", label: "Bank Statement", description: "Recent bank statement (last 3 months)" },
  { key: "proofOfAddressUrl", label: "Proof of Address", description: "Utility bill, lease, or official document" },
];

const OPTIONAL_DOCS = [
  { key: "proofOfNetWorthUrl", label: "Proof of Net Worth", description: "Tax return or financial statement (optional)" },
  { key: "accreditationLetterUrl", label: "Accreditation Letter", description: "From broker or investment firm (optional)" },
  { key: "sourceOfFundsDocUrl", label: "Source of Funds Document", description: "Supporting documentation (optional)" },
  { key: "corporateDocUrl", label: "Corporate Document", description: "Articles of incorporation or registration (optional for corporate investors)" },
];

interface DocState {
  [key: string]: string | null;
}

export function FinancialDocsStep({
  defaultValues,
  onSubmit,
  isLoading,
  investorType,
}: FinancialDocsStepProps) {
  const [uploadedDocs, setUploadedDocs] = useState<DocState>(
    Object.entries(defaultValues || {}).reduce((acc, [key, value]) => {
      if (key.endsWith("Url")) {
        acc[key] = value as string;
      }
      return acc;
    }, {} as DocState)
  );

  const form = useForm<FinancialDocsData>({
    resolver: zodResolver(financialDocsSchema),
    defaultValues: {
      ...defaultValues,
    },
  });

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
    });
  }, []);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const fileData = await fileToBase64(file);
        setUploadedDocs((prev) => ({
          ...prev,
          [fieldName]: fileData,
        }));
        form.setValue(fieldName as keyof FinancialDocsData, fileData);
      } catch (error) {
        console.error("Failed to process file:", error);
      }
    },
    [fileToBase64, form]
  );

  const removeFile = useCallback((fieldName: string) => {
    setUploadedDocs((prev) => ({
      ...prev,
      [fieldName]: null,
    }));
    form.setValue(fieldName as keyof FinancialDocsData, "");
  }, [form]);

  async function handleSubmit(data: FinancialDocsData) {
    await onSubmit(data);
  }

  const renderDocUpload = (
    docKey: string,
    label: string,
    description: string,
    isRequired: boolean
  ) => (
    <Card key={docKey} className="p-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2">
              {label}
              {isRequired ? (
                <Badge variant="default" className="ml-2">
                  Required
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-2">
                  Optional
                </Badge>
              )}
            </h4>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          {uploadedDocs[docKey] && (
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          )}
        </div>

        {uploadedDocs[docKey] ? (
          <div className="space-y-2">
            <div className="text-sm bg-muted p-3 rounded-lg flex items-center justify-between">
              <span>✓ File uploaded</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFile(docKey)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-3 cursor-pointer p-8 border-2 border-dashed rounded-lg hover:bg-muted transition-colors">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">Click to upload</p>
              <p className="text-xs text-muted-foreground">
                PDF, JPG, PNG (max 50MB)
              </p>
            </div>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFileUpload(e, docKey)}
              disabled={isLoading}
              className="hidden"
            />
          </label>
        )}

        {form.formState.errors[docKey as keyof FinancialDocsData] && (
          <FormMessage>
            {form.formState.errors[docKey as keyof FinancialDocsData]?.message}
          </FormMessage>
        )}
      </div>
    </Card>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
          <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          Upload financial documents to complete your KYI verification. All documents are securely
          encrypted and processed according to compliance standards.
        </AlertDescription>
      </Alert>

      {/* Required Documents Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Required Documents</h3>
          <p className="text-sm text-muted-foreground">
            These documents are mandatory for verification
          </p>
        </div>

        <div className="space-y-4">
          {REQUIRED_DOCS.map(({ key, label, description }) =>
            renderDocUpload(key, label, description, true)
          )}
        </div>
      </div>

      {/* Optional Documents Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Additional Documents</h3>
          <p className="text-sm text-muted-foreground">
            Optional documents may improve your application score
          </p>
        </div>

        <div className="space-y-4">
          {OPTIONAL_DOCS.map(({ key, label, description }) => {
            // Hide corporate doc for non-corporate investors
            if (key === "corporateDocUrl" && investorType !== "corporate") {
              return null;
            }
            return renderDocUpload(key, label, description, false);
          })}
        </div>
      </div>

      <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        <AlertDescription className="text-green-800 dark:text-green-200">
          All information will be verified using automated checks and reviewed by our compliance team.
        </AlertDescription>
      </Alert>

      <Button type="submit" disabled={isLoading} className="w-full" size="lg">
        {isLoading ? "Submitting..." : "Complete Verification"}
      </Button>
      </form>
    </Form>
  );
}
