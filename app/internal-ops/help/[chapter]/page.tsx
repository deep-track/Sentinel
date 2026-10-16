import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpArticle } from "@/components/help/help-article";
import { INTERNAL_MANUALS, getChapter, listChapters } from "@/backend/lib/help";

type Props = { params: Promise<{ chapter: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chapter = getChapter(INTERNAL_MANUALS, (await params).chapter);
  return { title: chapter ? `${chapter.title} · Back Office runbook` : "Back Office runbook" };
}

// One chapter of Manual D. Access is enforced by app/internal-ops/layout.tsx.
export default async function OpsHelpChapterPage({ params }: Props) {
  const chapter = getChapter(INTERNAL_MANUALS, (await params).chapter);
  if (!chapter) notFound();
  const all = listChapters(INTERNAL_MANUALS);
  const at = all.findIndex((entry) => entry.id === chapter.id);
  return (
    <HelpArticle
      chapter={chapter}
      basePath="/internal-ops/help"
      indexLabel="Back Office runbook"
      previous={all[at - 1] ?? null}
      next={all[at + 1] ?? null}
    />
  );
}
