import { Button } from "@/components/ui/button";
import type { ClientMembership } from "@/app/(platform)/_lib/active-client-constants";
import { SwitchOrganizationButton } from "./switch-organization-button";

// Shown instead of the portal when the selected organization's security
// rules (Settings → Security) block this session.
export function SecurityBlock({
  title,
  body,
  action,
  others,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
  others: ClientMembership[];
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-600">Sentinel security</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-4 text-slate-600 dark:text-slate-300">{body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {action ? (
            <Button asChild>
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <a href="/auth/logout">Logout</a>
          </Button>
        </div>
        {others.length > 0 ? (
          <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">Or switch to another organization:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {others.map((membership) => (
                <SwitchOrganizationButton key={membership.clientId} clientId={membership.clientId} name={membership.clientName} />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
