"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  investorProfileSchema,
  InvestorProfileData,
  INVESTOR_TYPE_LABELS,
  ACCREDITATION_LABELS,
  SOURCE_OF_FUNDS_LABELS,
  NET_WORTH_LABELS,
} from "@/lib/kyi-types";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface InvestorProfileStepProps {
  defaultValues?: Partial<InvestorProfileData>;
  onSubmit: (data: InvestorProfileData) => void | Promise<void>;
  isLoading?: boolean;
}

export function InvestorProfileStep({
  defaultValues,
  onSubmit,
  isLoading,
}: InvestorProfileStepProps) {
  const [pepDetails, setPepDetails] = useState(defaultValues?.isPEP || false);

  const form = useForm<InvestorProfileData>({
    resolver: zodResolver(investorProfileSchema),
    defaultValues: {
      investmentCurrency: "USD",
      isPEP: false,
      ...defaultValues,
    },
  });

  async function handleSubmit(data: InvestorProfileData) {
    await onSubmit(data);
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
      {/* Personal Information Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Personal Information</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name *</FormLabel>
                <FormControl>
                  <Input placeholder="John" {...field} disabled={isLoading} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Doe" {...field} disabled={isLoading} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address *</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="john@example.com"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number *</FormLabel>
              <FormControl>
                <Input
                  placeholder="+1 (555) 000-0000"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of Birth *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} disabled={isLoading} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nationality"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nationality *</FormLabel>
                <FormControl>
                  <Input placeholder="United States" {...field} disabled={isLoading} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="countryOfResidence"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country of Residence *</FormLabel>
              <FormControl>
                <Input placeholder="United States" {...field} disabled={isLoading} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Investor Classification Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Investor Classification</h3>
        </div>

        <FormField
          control={form.control}
          name="investorType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Investor Type *</FormLabel>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(INVESTOR_TYPE_LABELS).map(([value, label]) => (
                  <Card
                    key={value}
                    className={`p-4 cursor-pointer border-2 transition-colors ${
                      field.value === value
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                        : "border-border hover:border-blue-200"
                    }`}
                    onClick={() => field.onChange(value)}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroup value={field.value} onValueChange={field.onChange}>
                        <RadioGroupItem value={value} id={`investor-${value}`} />
                      </RadioGroup>
                      <label htmlFor={`investor-${value}`} className="cursor-pointer">
                        {label}
                      </label>
                    </div>
                  </Card>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="accreditationStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Accreditation Status *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger disabled={isLoading}>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(ACCREDITATION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sourceOfFunds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Primary Source of Funds *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger disabled={isLoading}>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(SOURCE_OF_FUNDS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="netWorthRange"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Net Worth Range *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger disabled={isLoading}>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(NET_WORTH_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="investmentAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Investment Amount *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="1000000"
                    {...field}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="investmentCurrency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger disabled={isLoading}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* PEP Declaration Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4">Politically Exposed Person (PEP)</h3>
        </div>

        <FormField
          control={form.control}
          name="isPEP"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => {
                    field.onChange(e.target.checked);
                    setPepDetails(e.target.checked);
                  }}
                  className="mt-1"
                  disabled={isLoading}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel className="text-base">
                  I am or have been a Politically Exposed Person (PEP)
                </FormLabel>
                <FormDescription>
                  PEPs are individuals who hold or have held prominent public positions
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        {pepDetails && (
          <>
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                Enhanced due diligence will be applied to your account
              </AlertDescription>
            </Alert>

            <FormField
              control={form.control}
              name="pepDetails"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Describe Your PEP Status *</FormLabel>
                  <FormControl>
                    <textarea
                      placeholder="Describe your role and position..."
                      {...field}
                      disabled={isLoading}
                      className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </FormControl>
                  <FormDescription>
                    Provide details about your position and time period
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </div>

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Processing..." : "Continue to Identity Verification"}
      </Button>
    </form>
  );
}
