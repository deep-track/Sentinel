import { Shield, ArrowRight } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-violet-600 to-violet-700 flex items-center justify-center shadow-lg">
              <Shield className="h-7 w-7 text-white" />
            </div>
            <span className="text-2xl font-bold text-slate-900 dark:text-white">DeepTrack</span>
          </div>
        </div>

        {/* Welcome */}
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Welcome
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Log in to your DeepTrack account to continue
          </p>
        </div>

        {/* Sign in button */}
        <form
          action="/api/auth/login"
          method="GET"
          className="space-y-6"
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-semibold rounded-lg transition-colors shadow-md hover:shadow-lg"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Footer */}
        <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
          © 2024 DeepTrack. All rights reserved.
        </p>
      </div>
    </div>
  );
}
