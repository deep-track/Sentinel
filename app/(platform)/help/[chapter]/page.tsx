import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpArticle } from "@/components/help/help-article";
import { CLIENT_MANUALS, getChapter, listChapters } from "@/backend/lib/help";

type Props = { params: Promise<{ chapter: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chapter = getChapter(CLIENT_MANUALS, (await params).chapter);
  return { title: chapter ? `${chapter.title} · Sentinel Help` : "Sentinel Help" };
}

// One chapter of Manuals A–C. Manual D (Back Office) is never served here.
export default async function HelpChapterPage({ params }: Props) {
  const chapter = getChapter(CLIENT_MANUALS, (await params).chapter);
  if (!chapter) notFound();
  const all = listChapters(CLIENT_MANUALS);
  const at = all.findIndex((entry) => entry.id === chapter.id);
  return (
    <HelpArticle
      chapter={chapter}
      basePath="/help"
      indexLabel="Help"
      previous={all[at - 1] ?? null}
      next={all[at + 1] ?? null}
    />
  );
}
