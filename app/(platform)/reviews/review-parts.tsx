"use client";

import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";

export type ReviewSummary = {
  _id: string;
  createdAt: number;
  status: "pending" | "in_review" | "resolved";
  priority: "low" | "normal" | "high";
  category: string;
  categoryLabel: string;
  queue: string;
  queueLabel: string;
  dueAt: number | null;
  overdue: boolean;
  triggerReason: string;
  assignee: { userId: string; name: string } | null;
  recommendation: { action: "approve" | "reject"; by: string; byName: string; at: number; reasonCode: string | null } | null;
  escalatedAt: number | null;
  resolution: { action: string | null; verdict: "pass" | "reject" | null; byName: string | null; source: "client" | "deeptrack" | null; reasonCode: string | null; at: number | null } | null;
  verification: { _id: string; type: string; reference: string; verdict: string | null; subject: string; href: string | null } | null;
};

const CATEGORY_STYLE: Record<string, string> = {
  sanctions: "border-red-300 bg-red-50 text-red-800",
  pep: "border-amber-300 bg-amber-50 text-amber-800",
  adverse_media: "border-orange-300 bg-orange-50 text-orange-800",
  document_fraud: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800",
  high_risk: "border-amber-300 bg-amber-50 text-amber-800",
  standard: "",
};

export function CategoryBadge({ category, label }: { category: string; label: string }) {
  return (
    <Badge variant="outline" className={CATEGORY_STYLE[category] ?? ""}>
      {label}
    </Badge>
  );
}

export function PriorityBadge({ priority, escalated }: { priority: "low" | "normal" | "high"; escalated?: boolean }) {
  return (
    <span className={`text-sm ${priority === "high" ? "font-semibold text-red-700" : priority === "low" ? "text-muted-foreground" : ""}`}>
      {priority[0].toUpperCase()}
      {priority.slice(1)}
      {escalated ? <span className="ml-1 text-xs font-normal text-red-700">· escalated</span> : null}
    </span>
  );
}

export function DueLabel({ dueAt, overdue }: { dueAt: number | null; overdue: boolean }) {
  if (!dueAt) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={overdue ? "font-semibold text-red-700" : "text-muted-foreground"}>
      {overdue ? "Overdue · " : ""}
      <ClientDate value={dueAt} format="PPp" />
    </span>
  );
}
