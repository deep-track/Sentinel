// Writes the training video catalog that Sentinel's Help pages read
// (backend/convex/lib/trainingVideoCatalog.json) from the video scripts:
// each video's id, title, the chapters it belongs to and whether it is a
// Back Office (internal) video. Run after adding or renaming a script.
//   node tools/videos/catalog.mjs
import fs from "node:fs";
import path from "node:path";
import { REPO, ROOT } from "./lib.mjs";

const scripts = fs
  .readdirSync(path.join(ROOT, "scripts"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", file), "utf8")))
  .sort((a, b) => a.order - b.order);

const catalog = scripts.map((script) => ({
  id: script.video,
  title: script.title,
  chapters: String(script.chapter).split(",").map((chapter) => chapter.trim()).filter(Boolean),
  course: script.course,
  order: script.order,
  internal: script.internal === true,
}));

const out = path.join(REPO, "backend", "convex", "lib", "trainingVideoCatalog.json");
fs.writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
console.log(`${catalog.length} videos → ${path.relative(REPO, out)}`);
