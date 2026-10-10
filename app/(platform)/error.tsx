"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getConvexErrorCode, getConvexErrorMessage } from "@/modules/shared/errors";

const MESSAGES: Record<string, { title: string; body: string }> = {
  unauthenticated: {
    title: "Your session has expired",
    body: "Sign in again to continue.",
  },
  forbidden: {
    title: "You don't have access to this",
    body: "Your role in the selected organization doesn't allow this page. Try switching organization in the sidebar, or ask an administrator for access.",
  },
  insufficient_credits: {
    title: "Not enough credits",
    body: "Your organization has run out of verification credits. Top up on the Billing & Credits page.",
  },
  rate_limited: {
    title: "Too many requests",
    body: "Please wait a moment, then try again.",
  },
};

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[platform] render error", error);
  }, [error]);

  const code = getConvexErrorCode(error);
  const known = code ? MESSAGES[code] : undefined;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {known?.title ?? "Something went wrong"}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {known?.body ??
              getConvexErrorMessage(error) ??
              "This page couldn't be loaded. Try again in a moment."}
          </p>
          {error.digest ? (
            <p className="text-xs text-slate-400 font-mono pt-2">Reference: {error.digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {code === "unauthenticated" ? (
            <Button asChild>
              {/* Auth routes are handled by middleware, not the Next router. */}
              <a href="/auth/login">Sign in</a>
            </Button>
          ) : (
            <Button type="button" onClick={() => reset()}>
              <RotateCcw className="mr-2 h-4 w-4" /> Try again
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
