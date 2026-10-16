"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ChapterMeta, ManualId } from "@/backend/lib/help";

type Manual = { id: ManualId; letter: string; title: string; audience: string };

// Table of contents for the manuals, with a search over chapter titles and
// summaries.
export function HelpIndex({ manuals, chapters, basePath }: { manuals: Manual[]; chapters: ChapterMeta[]; basePath: string }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = chapters.filter((chapter) => {
    const haystack = `${chapter.id} ${chapter.title} ${chapter.summary}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chapters, e.g. capture link, STR, four-eyes"
          aria-label="Search help chapters"
          className="pl-9"
        />
      </div>
      {words.length > 0 && matches.length === 0 ? (
        <p className="text-sm text-slate-500">No chapter title matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : null}
      {manuals.map((manual) => {
        const list = matches.filter((chapter) => chapter.manual === manual.id);
        if (list.length === 0) return null;
        return (
          <section key={manual.id} aria-labelledby={`manual-${manual.id}`}>
            <h2 id={`manual-${manual.id}`} className="text-lg font-semibold text-slate-900 dark:text-white">
              Manual {manual.letter}: {manual.title}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{manual.audience}</p>
            <ol className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {list.map((chapter) => (
                <li key={chapter.id}>
                  <Link href={`${basePath}/${chapter.id}`} className="flex gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                    <span className="w-10 flex-shrink-0 font-mono text-sm text-slate-400">{chapter.id.toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900 dark:text-white">{chapter.title}</span>
                      {chapter.summary ? <span className="block text-sm text-slate-500 dark:text-slate-400">{chapter.summary}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
