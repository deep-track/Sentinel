#!/usr/bin/env node
// Vercel build (package.json "vercel-build", which Vercel runs instead of
// "build"). Production builds also deploy the Convex backend, so a merge to
// main ships the backend and the site together; before this, the site went
// live first and called functions that weren't deployed yet.
//
// Production (VERCEL_ENV=production) with CONVEX_DEPLOY_KEY set:
//   1. `convex deploy --dry-run`: stop if the push would delete any table
//      index (deleting an index can break live queries); set
//      ALLOW_CONVEX_INDEX_DELETION=1 for one deploy to allow it.
//   2. `next build`: a failed build stops here, before the backend changes.
//   3. `convex deploy`: the new backend goes live, then Vercel promotes the
//      new site (old pages keep working: changes are backward compatible).
// Previews and local builds only run `next build`.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (capture) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  if (result.status !== 0) {
    console.error(`\n[vercel-build] ${command} ${args.join(" ")} failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

// Index lines the dry run would delete ("[-] table.index ...").
export function deletedIndexes(output) {
  const start = output.indexOf("Would delete table indexes");
  if (start === -1) return [];
  const section = output.slice(start).split("\n").slice(1);
  const lines = [];
  for (const line of section) {
    if (/^\s*\[-\]/.test(line)) lines.push(line.trim());
    else if (line.trim() && !/^\s/.test(line)) break;
  }
  return lines;
}

function main() {
  const production = process.env.VERCEL_ENV === "production";
  const deployKey = process.env.CONVEX_DEPLOY_KEY?.trim();

  if (!production || !deployKey) {
    if (production) console.warn("[vercel-build] CONVEX_DEPLOY_KEY is not set: building the site only. Deploy Convex by hand.");
    run("npx", ["next", "build"]);
    return;
  }

  console.log("[vercel-build] Checking the Convex deploy (dry run)…");
  const dryRun = run("npx", ["convex", "deploy", "--dry-run", "-y"], { capture: true });
  const deleted = deletedIndexes(dryRun);
  if (deleted.length > 0 && process.env.ALLOW_CONVEX_INDEX_DELETION !== "1") {
    console.error(`\n[vercel-build] This deploy would delete Convex indexes:\n  ${deleted.join("\n  ")}\nStopping. If that's intended, redeploy with ALLOW_CONVEX_INDEX_DELETION=1.`);
    process.exit(1);
  }

  console.log("[vercel-build] Building the site…");
  run("npx", ["next", "build"]);

  console.log("[vercel-build] Deploying the Convex backend…");
  run("npx", ["convex", "deploy", "-y"]);
  console.log("[vercel-build] Done: backend deployed; Vercel promotes the site next.");
}

// Run only when executed directly (tests import deletedIndexes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
