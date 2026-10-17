// Makes one or more videos end to end: narrate (unless already narrated),
// record, assemble. Prints a summary of every step that missed its target.
//   node tools/videos/make.mjs v01-dashboard-tour v02-how-sentinel-decides
//   node tools/videos/make.mjs --all [--voice default]   (narrate only that voice)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OUT, ROOT } from "./lib.mjs";

const names = process.argv.includes("--all")
  ? fs.readdirSync(path.join(ROOT, "scripts")).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, "")).sort()
  : process.argv.slice(2).filter((arg, index, all) => !arg.startsWith("--") && all[index - 1] !== "--voice");

const run = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const voiceIndex = process.argv.indexOf("--voice");
const voice = voiceIndex > 0 ? process.argv[voiceIndex + 1] : undefined;
const summary = [];
for (const name of names) {
  console.log(`\n=== ${name}`);
  const narrated = fs.existsSync(path.join(OUT, name, "default", "narration.json"));
  if (!narrated) {
    const narration = run("narrate.mjs", [name, ...(voice ? [voice] : [])]);
    process.stdout.write(narration.out);
    if (!fs.existsSync(path.join(OUT, name, "default", "narration.json"))) {
      summary.push({ name, status: "narration failed" });
      continue;
    }
  }
  const recording = run("record.mjs", [name]);
  const misses = recording.out.split("\n").filter((line) => line.trim().startsWith("!"));
  process.stdout.write(recording.out.split("\n").filter((line) => /!|Recorded/.test(line)).join("\n") + "\n");
  if (!recording.ok) {
    summary.push({ name, status: "recording failed", detail: recording.out.slice(-400) });
    continue;
  }
  const assembly = run("assemble.mjs", [name]);
  process.stdout.write(assembly.out);
  summary.push({ name, status: assembly.ok ? "made" : "assembly failed", misses: misses.length, detail: misses.map((line) => line.trim()).slice(0, 8) });
}
console.log("\n=== Summary");
for (const row of summary) console.log(`${row.name}: ${row.status}${row.misses ? ` (${row.misses} missed steps)` : ""}${row.detail?.length ? `\n    ${[].concat(row.detail).join("\n    ")}` : ""}`);
