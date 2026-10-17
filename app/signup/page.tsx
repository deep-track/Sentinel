import Image from "next/image";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Start a free trial | Sentinel" };

// Public self-service sign-up: a 14-day trial with free credits.
export default function SignupPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-md">
        <div className="flex justify-center">
          <Image src="/deeptrack-transparent.png" alt="DeepTrack" width={180} height={39} priority className="dark:invert" />
        </div>
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Start your free Sentinel trial</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            14 days and about 25 free checks: KYC identity, AML screening and monitoring, document and business verification. No card needed.
          </p>
          <div className="mt-6">
            <SignupForm />
          </div>
        </section>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <a href="/auth/login" className="font-medium text-slate-900 underline dark:text-white">
            Sign in
          </a>
          {" · "}
          <Link href="mailto:sales@deeptrack.io" className="underline">
            Talk to sales
          </Link>
        </p>
      </div>
    </main>
  );
}
