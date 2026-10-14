import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { SettingsNav } from "./settings-nav";

// Settings for the organization selected in the sidebar. Its Admin manages
// the team and the rules; everyone else can read them.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { scope } = await requireActiveScope();
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{scope.clientName}: your team, review workflow, rules and security</p>
      </div>
      <SettingsNav />
      {children}
    </div>
  );
}
