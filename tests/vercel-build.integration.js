const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "vercel-build.mjs");

test("production builds stop when the Convex push would delete an index", async () => {
  const { deletedIndexes } = await import(pathToFileURL(script).href);
  const blocked = [
    "\u001b[32m✔\u001b[39m No large indexes are deleted by this push",
    "✔ Would delete table indexes:",
    "  [-] clientSettings.by_sso_connection   ssoConnectionName, _creationTime",
    "✔ Would add table indexes:",
    "  [+] strReports.by_verification   verificationId, _creationTime",
    "✔ Would have deployed Convex functions to https://robust-parakeet-542.convex.cloud",
  ].join("\n");
  assert.deepEqual(deletedIndexes(blocked), ["[-] clientSettings.by_sso_connection   ssoConnectionName, _creationTime"]);
  assert.deepEqual(deletedIndexes("✔ No indexes are deleted by this push\n✔ Would have deployed Convex functions"), []);
  assert.deepEqual(deletedIndexes("✔ Would add table indexes:\n  [+] a.b   x\n"), [], "added indexes are fine");
});

test("Vercel runs the build script; only production deploys Convex, last", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["vercel-build"], "node scripts/vercel-build.mjs");
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /const production = process\.env\.VERCEL_ENV === "production";/);
  const dry = source.indexOf('["convex", "deploy", "--dry-run", "-y"]');
  const build = source.lastIndexOf('run("npx", ["next", "build"]);');
  const deploy = source.indexOf('["convex", "deploy", "-y"]');
  assert.ok(dry > 0 && dry < build && build < deploy, "dry run, then the site build, then the backend deploy");
});
