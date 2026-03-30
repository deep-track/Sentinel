import Link from "next/link";
import { Shield } from "lucide-react";

export default function AMLProfileNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
      <div className="h-20 w-20 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Shield className="h-10 w-10 text-slate-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Profile Not Found
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
          This entity could not be found in the sanctions database.
        </p>
      </div>
      <Link
        href="/aml-check"
        className="rounded-lg bg-black hover:bg-black/80 text-white text-sm font-medium px-6 py-2.5 transition-colors"
      >
        Back to AML Check
      </Link>
    </div>
  );
}
