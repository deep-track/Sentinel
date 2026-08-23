"use client";

import { cn } from "@/backend/lib/utils";
import type { KYCStatus } from "@/backend/lib/kyc-types";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  FileQuestion,
  TimerOff,
} from "lucide-react";

interface KYCStatusBadgeProps {
  status: KYCStatus;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

const STATUS_CONFIG: Record<
  KYCStatus,
  {
    label: string;
    icon: React.ElementType;
    className: string;
    iconClassName: string;
  }
> = {
  draft: {
    label: "Draft",
    icon: FileQuestion,
    className:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    iconClassName: "text-slate-400",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
    iconClassName: "text-amber-500",
  },
  processing: {
    label: "Processing",
    icon: Loader2,
    className:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800",
    iconClassName: "text-violet-500 animate-spin",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle,
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
    iconClassName: "text-emerald-500",
  },
  declined: {
    label: "Declined",
    icon: XCircle,
    className:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
    iconClassName: "text-red-500",
  },
  requires_review: {
    label: "Needs Review",
    icon: AlertCircle,
    className:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800",
    iconClassName: "text-orange-500",
  },
  expired: {
    label: "Expired",
    icon: TimerOff,
    className:
      "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700",
    iconClassName: "text-slate-400",
  },
};

const SIZE_CLASSES = {
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
  lg: "text-sm px-3 py-1.5 gap-2",
};

const ICON_SIZES = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

export function KYCStatusBadge({ status, size = "md", showIcon = true }: KYCStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center rounded-full border font-medium", SIZE_CLASSES[size], config.className)}>
      {showIcon && <Icon className={cn(ICON_SIZES[size], config.iconClassName)} />}
      {config.label}
    </span>
  );
}
