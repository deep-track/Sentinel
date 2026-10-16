"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { RiskLevelBadge, type RatingView } from "@/components/risk/risk-rating";

type Customer = {
  _id: string;
  reference: string;
  subjectName: string;
  entityType: "individual" | "entity";
  externalRef: string | null;
  rating: RatingView | null;
  nextReviewAt: number | null;
  lastReviewedAt: number | null;
  due: boolean;
  enrolledVerificationId: string;
};
type Data = { customers: Customer[]; levels: Record<string, number>; due: number };

export function CustomersView({ clientId }: { clientId: string }) {
  const [dueOnly, setDueOnly] = useState(false);
  const data = useAuthedQuery(anyApi.riskRatings.customers, { clientId, dueOnly }) as Data | undefined;
  const markReviewed = useMutation(anyApi.riskRatings.markReviewed);
  if (!data) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-5">
        {(["high", "medium", "low", "prohibited", "unrated"] as const).map((level) => (
          <Card key={level} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{level === "unrated" ? "Not rated yet" : `${level} risk`}</p>
            <p className="mt-1 text-2xl font-semibold">{data.levels[level] ?? 0}</p>
          </Card>
        ))}
      </div>
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <p className="text-sm font-medium">{data.due ? `${data.due} due for periodic review` : "No reviews due"}</p>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} /> Due only
          </label>
        </div>
        {data.customers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No monitored customers{dueOnly ? " are due" : " yet. Turn on ongoing monitoring when you screen a customer"}.</p>
        ) : (
          <ul className="divide-y">
            {data.customers.map((customer) => (
              <li key={customer._id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <Link href={`/aml-check/${customer.enrolledVerificationId}`} className="font-medium hover:underline">
                    {customer.subjectName}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {customer.entityType === "entity" ? "Organisation" : "Person"} · {customer.reference}
                    {customer.externalRef ? ` · ${customer.externalRef}` : ""}
                  </span>
                  {customer.rating?.factors.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">{customer.rating.factors.slice(0, 3).map((factor) => factor.detail).join(" · ")}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {customer.rating ? <RiskLevelBadge level={customer.rating.level} score={customer.rating.score} /> : <span className="text-xs text-muted-foreground">Not rated</span>}
                  <span className={`text-xs ${customer.due ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                    {customer.nextReviewAt ? (
                      <>
                        {customer.due ? "Review due " : "Next review "}
                        <ClientDate value={customer.nextReviewAt} format="PP" />
                      </>
                    ) : (
                      "No review date"
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={customer.due ? "default" : "outline"}
                    onClick={() => {
                      const notes = window.prompt(`What did the periodic review of ${customer.subjectName} cover? (documents refreshed, source of funds, screening results…)`);
                      if (!notes?.trim()) return;
                      void markReviewed({ subjectId: customer._id, notes }).then(
                        () => toast.success("Review recorded. The customer is re-screened now."),
                        (error: unknown) => toast.error(getErrorMessage(error, "Couldn't record the review.")),
                      );
                    }}
                  >
                    Mark reviewed
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
