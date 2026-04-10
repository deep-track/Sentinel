import { CheckCircle } from "lucide-react";
import Link from "next/link";

export default function LoggedOutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-black dark:via-slate-900 dark:to-black flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8 text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              You've been logged out
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your session has been securely ended. You'll be redirected to the sign-in page shortly.
            </p>
          </div>

          {/* CTA */}
          <div>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-medium rounded-lg transition-colors w-full"
            >
              Sign In Again
            </Link>
          </div>

          {/* Redirect script */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                setTimeout(() => {
                  window.location.href = "/sign-in";
                }, 3000);
              `,
            }}
          />
        </div>

        {/* Footer branding */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            © 2024 DeepTrack. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
