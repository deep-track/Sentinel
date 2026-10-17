import Link from "next/link";
import type { Chapter, ChapterMeta } from "@/backend/lib/help";
import { MANUALS } from "@/backend/lib/help";
import { HelpVideos } from "./help-videos";

// Typography for a rendered chapter. The Markdown comes from content/help in
// this repo (never from users), so it is rendered as HTML.
const PROSE = [
  "text-[15px] leading-7 text-slate-700 dark:text-slate-300",
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:scroll-mt-20 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 dark:[&_h3]:text-white",
  "[&_p]:my-3 [&_strong]:font-semibold [&_strong]:text-slate-900 dark:[&_strong]:text-white",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
  "[&_a]:text-sky-700 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-sky-400",
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] dark:[&_code]:bg-slate-800",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-slate-100",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold dark:[&_th]:border-slate-700 dark:[&_th]:bg-slate-900",
  "[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top dark:[&_td]:border-slate-700",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-sky-300 [&_blockquote]:pl-4 [&_blockquote]:text-slate-600",
  "[&_img]:my-4 [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-200",
  "[&_.help-shot-todo]:my-4 [&_.help-shot-todo]:flex [&_.help-shot-todo]:min-h-24 [&_.help-shot-todo]:items-center [&_.help-shot-todo]:justify-center [&_.help-shot-todo]:rounded-lg [&_.help-shot-todo]:border [&_.help-shot-todo]:border-dashed [&_.help-shot-todo]:border-slate-300 [&_.help-shot-todo]:bg-slate-50 [&_.help-shot-todo]:px-4 [&_.help-shot-todo]:text-center [&_.help-shot-todo]:text-sm [&_.help-shot-todo]:text-slate-500 dark:[&_.help-shot-todo]:border-slate-700 dark:[&_.help-shot-todo]:bg-slate-900",
].join(" ");

export function HelpArticle({
  chapter,
  basePath,
  indexLabel,
  previous,
  next,
}: {
  chapter: Chapter;
  basePath: string;
  indexLabel: string;
  previous: ChapterMeta | null;
  next: ChapterMeta | null;
}) {
  const manual = MANUALS[chapter.manual];
  return (
    <div className="mx-auto flex max-w-6xl gap-10 p-6 lg:p-8">
      <article className="min-w-0 flex-1">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500 dark:text-slate-400">
          <Link href={basePath} className="hover:underline">
            {indexLabel}
          </Link>
          <span aria-hidden="true"> / </span>
          <span>
            Manual {manual.letter}: {manual.title}
          </span>
        </nav>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          <span className="text-slate-400">{chapter.id.toUpperCase()}</span> {chapter.title}
        </h1>
        {chapter.summary ? <p className="mt-2 text-slate-600 dark:text-slate-400">{chapter.summary}</p> : null}
        {chapter.roles ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium">Roles:</span> {chapter.roles}
          </p>
        ) : null}
        <HelpVideos chapterId={chapter.id} />
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: chapter.html }} />
        <nav aria-label="Chapters" className="mt-12 flex justify-between gap-4 border-t border-slate-200 pt-6 text-sm dark:border-slate-800">
          {previous ? (
            <Link href={`${basePath}/${previous.id}`} className="text-sky-700 hover:underline dark:text-sky-400">
              ← {previous.id.toUpperCase()} {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`${basePath}/${next.id}`} className="text-right text-sky-700 hover:underline dark:text-sky-400">
              {next.id.toUpperCase()} {next.title} →
            </Link>
          ) : null}
        </nav>
      </article>
      {chapter.headings.length > 0 ? (
        <aside className="hidden w-56 flex-shrink-0 xl:block">
          <div className="sticky top-16">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">On this page</div>
            <ul className="mt-3 space-y-2 text-sm">
              {chapter.headings.map((heading) => (
                <li key={heading.id}>
                  <a href={`#${heading.id}`} className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
