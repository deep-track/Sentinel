import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/backend/lib/auth";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type AccessPendingPageProps = {
  searchParams?: Promise<{ reason?: string }>;
};

export default async function AccessPendingPage({
  searchParams,
}: AccessPendingPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const reason = (await searchParams)?.reason;
  const authorizationUnavailable = reason === "authorization-unavailable";

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-600">
          Sentinel access
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
          {authorizationUnavailable
            ? "Access service unavailable"
            : "Access is being prepared"}
        </h1>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          {authorizationUnavailable
            ? "We could not verify your customer access right now. Please try again in a few minutes."
            : "Your sign-in succeeded, but no active customer workspace is assigned to this account yet."}
        </p>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Signed in as {user.email}. Contact your Sentinel administrator if you
          believe you should already have access.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Try again</Link>
          </Button>
          <Button asChild variant="outline">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/auth/logout">Logout</a>
          </Button>
        </div>
      </section>
    </main>
  );
}
