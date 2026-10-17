import "server-only";

import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

// The user manual: one Markdown file per chapter under content/help/<manual>/,
// named <id>-<slug>.md, with a short front-matter block (id, title, summary,
// roles). Manuals A–C are for client users (/help); Manual D is the Back
// Office runbook for DeepTrack staff (/internal-ops/help) and is never served
// on a client route. The same files feed the PDF and the training-video
// scripts, so the page only renders them.

export type ManualId = "a" | "b" | "c" | "d";

export const MANUALS: Record<ManualId, { letter: string; title: string; audience: string; internal: boolean }> = {
  a: { letter: "A", title: "Getting started and administration", audience: "For your organization's Admin.", internal: false },
  b: { letter: "B", title: "Running checks and reviewing them", audience: "For compliance analysts and reviewers.", internal: false },
  c: { letter: "C", title: "Developer guide", audience: "For engineers integrating Sentinel.", internal: false },
  d: { letter: "D", title: "Back Office runbook", audience: "For DeepTrack staff only.", internal: true },
};

export const CLIENT_MANUALS: ManualId[] = ["a", "b", "c"];
export const INTERNAL_MANUALS: ManualId[] = ["d"];

export type ChapterMeta = {
  id: string;
  manual: ManualId;
  title: string;
  summary: string;
  roles: string;
};

export type Chapter = ChapterMeta & {
  html: string;
  headings: Array<{ id: string; text: string }>;
};

const HELP_DIR = path.join(process.cwd(), "content", "help");

function parseFrontMatter(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  const fields: Record<string, string> = {};
  if (!match) return { fields, body: source };
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: source.slice(match[0].length) };
}

function chapterOrder(id: string) {
  return Number(id.slice(1)) || 0;
}

function chapterFiles(manual: ManualId) {
  const dir = path.join(HELP_DIR, manual);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ id: name.split("-")[0].toLowerCase(), file: path.join(dir, name) }));
}

export function listChapters(manuals: ManualId[]): ChapterMeta[] {
  return manuals
    .flatMap((manual) =>
      chapterFiles(manual).map(({ id, file }) => {
        const { fields } = parseFrontMatter(fs.readFileSync(file, "utf8"));
        return {
          id,
          manual,
          title: fields.title ?? id.toUpperCase(),
          summary: fields.summary ?? "",
          roles: fields.roles ?? "",
        };
      }),
    )
    .sort((a, b) => a.manual.localeCompare(b.manual) || chapterOrder(a.id) - chapterOrder(b.id));
}

// Heading text for the "On this page" list, which React escapes itself: the
// HTML entities marked adds (an apostrophe becomes &#39;) are turned back.
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: String.fromCharCode(160) };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The runbook's (Manual D) screenshots aren't public: they are served by
// app/internal-ops/help/shots, to DeepTrack staff only.
export function shotUrl(href: string): string {
  return /^\/help\/shots\/d\d+-/.test(href) ? href.replace("/help/shots/", "/internal-ops/help/shots/") : href;
}

function render(body: string) {
  const headings: Chapter["headings"] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this: { parser: { parseInline: (tokens: Tokens.Heading["tokens"]) => string } }, { tokens, depth }: Tokens.Heading) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html);
        if (depth === 2) headings.push({ id, text: decodeEntities(html.replace(/<[^>]+>/g, "")) });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
      // Screenshots still to be taken are written with the title "TODO"; show
      // a labelled placeholder instead of a broken image.
      image({ href, title, text }: Tokens.Image) {
        if (title === "TODO") {
          return `<span class="help-shot-todo" role="img" aria-label="${escapeHtml(text)}">Screenshot: ${escapeHtml(text)}</span>`;
        }
        return `<img src="${escapeHtml(shotUrl(href))}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" />`;
      },
    },
  });
  const html = marked.parse(body, { async: false }) as string;
  return { html, headings };
}

export function getChapter(manuals: ManualId[], id: string): Chapter | null {
  const wanted = id.toLowerCase();
  for (const manual of manuals) {
    const found = chapterFiles(manual).find((entry) => entry.id === wanted);
    if (!found) continue;
    const { fields, body } = parseFrontMatter(fs.readFileSync(found.file, "utf8"));
    return {
      id: wanted,
      manual,
      title: fields.title ?? wanted.toUpperCase(),
      summary: fields.summary ?? "",
      roles: fields.roles ?? "",
      ...render(body),
    };
  }
  return null;
}
