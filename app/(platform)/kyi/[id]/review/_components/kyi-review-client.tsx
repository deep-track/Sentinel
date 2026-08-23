"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { KYIRecord } from "@/backend/lib/kyi-types";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/backend/lib/utils";

// NOTE: reviewKYI previously came from actions/kyi.ts, which was
// removed as part of the Convex backend migration. There is no public
// Convex mutation yet for submitting a KYI review decision. This
// returns an honest failure instead of pretending to succeed; the
// existing toast.error() call below already surfaces it.
/* eslint-disable @typescript-eslint/no-unused-vars */
async function reviewKYI(payload: {
  id: string;
  decision: string;
  notes?: string;
  declineReason?: string;
}): Promise<{ success: boolean; error?: string }> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return { success: false, error: "KYI review submission isn't wired to the backend yet." };
}

const schema = z
  .object({
    decision: z.enum(["approved", "declined"]),
    notes: z.string().optional(),
    declineReason: z.string().optional(),
  })
  .refine((value) => value.decision !== "declined" || (value.declineReason && value.declineReason.length > 5), {
    message: "Please provide a decline reason",
    path: ["declineReason"],
  });

type FormData = z.infer<typeof schema>;

interface KYIReviewClientProps {
  record: KYIRecord;
}

export function KYIReviewClient({ record }: KYIReviewClientProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approved" | "declined" | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      decision: undefined as unknown as "approved" | "declined",
      notes: "",
      declineReason: "",
    },
  });

  async function onSubmit(values: FormData) {
    const result = await reviewKYI({
      id: record.id,
      decision: values.decision,
      notes: values.notes,
      declineReason: values.declineReason,
    });

    if (result.success) {
      toast.success(values.decision === "approved" ? "KYI approved successfully" : "KYI declined");
      router.push(`/kyi/${record.id}`);
      router.refresh();
    } else {
      toast.error(result.error ?? "Failed to submit review");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              {[record.extractedData?.name?.first_name, record.extractedData?.name?.last_name].filter(Boolean).join(" ") || record.userName}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">
              {record.investorType?.replace(/_/g, " ")} • {record.userEmail}
            </p>
            <code className="text-xs font-mono text-slate-500 mt-1 block">{record.reference}</code>
          </div>
          <KYIStatusBadge status={record.status} />
        </div>
      </div>

      {record.isPEP && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-4">
          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <p className="text-sm font-medium">
              This investor is flagged as a PEP. Additional scrutiny is required before approval.
            </p>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4">Review Decision</h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setDecision("approved");
              form.setValue("decision", "approved");
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all",
              decision === "approved"
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-600"
                : "border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700",
            )}
          >
            <div className={cn("h-12 w-12 rounded-full flex items-center justify-center", decision === "approved" ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-slate-100 dark:bg-slate-800")}>
              <CheckCircle className={cn("h-6 w-6", decision === "approved" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")} />
            </div>
            <div className="text-center">
              <p className={cn("font-semibold", decision === "approved" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300")}>Approve</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Investor cleared</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setDecision("declined");
              form.setValue("decision", "declined");
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all",
              decision === "declined"
                ? "border-red-500 bg-red-50 dark:bg-red-900/20 dark:border-red-600"
                : "border-slate-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-700",
            )}
          >
            <div className={cn("h-12 w-12 rounded-full flex items-center justify-center", decision === "declined" ? "bg-red-100 dark:bg-red-900/40" : "bg-slate-100 dark:bg-slate-800")}>
              <XCircle className={cn("h-6 w-6", decision === "declined" ? "text-red-600 dark:text-red-400" : "text-slate-400")} />
            </div>
            <div className="text-center">
              <p className={cn("font-semibold", decision === "declined" ? "text-red-700 dark:text-red-400" : "text-slate-700 dark:text-slate-300")}>Decline</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Requires remediation</p>
            </div>
          </button>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {decision === "declined" && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-4 space-y-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-medium">Decline Details Required</p>
              </div>
              <FormField
                control={form.control}
                name="declineReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-red-700 dark:text-red-400">Reason for Declining</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. Source of funds documentation is insufficient..."
                        rows={3}
                        className="resize-none border-red-200 dark:border-red-800 focus:ring-red-500"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Internal Notes (optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Add notes for your team..." rows={3} className="resize-none" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={form.formState.isSubmitting}
              className="flex-1"
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button
              type="submit"
              disabled={!decision || form.formState.isSubmitting}
              className={cn(
                "flex-1 text-white",
                decision === "approved"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : decision === "declined"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-slate-400 cursor-not-allowed",
              )}
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...
                </>
              ) : decision === "approved" ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" /> Confirm Approval
                </>
              ) : decision === "declined" ? (
                <>
                  <XCircle className="mr-2 h-4 w-4" /> Confirm Decline
                </>
              ) : (
                "Select a decision"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}