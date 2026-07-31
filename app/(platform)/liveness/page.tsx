import { LivenessCapture } from "./liveness-capture";

export default function LivenessPage() {
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Liveness
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Record a short liveness session to verify a real, present person
        </p>
      </div>

      <LivenessCapture />
    </div>
  );
}