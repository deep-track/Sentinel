import { HelpIndex } from "@/components/help/help-index";
import { CLIENT_MANUALS, MANUALS, listChapters } from "@/backend/lib/help";

// The user manual for client users (Manuals A–C). Chapters live as Markdown
// under content/help.
export default function HelpPage() {
  const chapters = listChapters(CLIENT_MANUALS);
  const manuals = CLIENT_MANUALS.filter((id) => chapters.some((chapter) => chapter.manual === id)).map((id) => ({ id, ...MANUALS[id] }));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Help</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          How to use Sentinel, step by step: running checks, reviewing them, setting up your organization and connecting to the API.
        </p>
      </div>
      <HelpIndex manuals={manuals} chapters={chapters} basePath="/help" />
    </div>
  );
}
