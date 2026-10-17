const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lib = read("backend/convex/lib/trainingVideos.ts");
const access = read("backend/convex/trainingVideos.ts");
const node = read("backend/convex/trainingVideosNode.ts");

test("the catalog matches the video scripts", () => {
  const catalog = JSON.parse(read("backend/convex/lib/trainingVideoCatalog.json"));
  const scripts = fs.readdirSync(path.join(root, "tools/videos/scripts")).filter((file) => file.endsWith(".json"));
  assert.equal(catalog.length, scripts.length, "run node tools/videos/catalog.mjs");
  for (const file of scripts) {
    const script = JSON.parse(read(`tools/videos/scripts/${file}`));
    const entry = catalog.find((row) => row.id === script.video);
    assert.ok(entry, script.video);
    assert.equal(entry.internal, script.internal === true, `${script.video} internal flag`);
  }
  // Back Office videos are the internal ones, and only those.
  for (const entry of catalog) assert.equal(entry.internal, entry.chapters.every((chapter) => chapter.startsWith("d")), entry.id);
});

test("videos are never public: a private bucket, short-lived links, viewers checked", () => {
  assert.match(lib, /export const DEFAULT_TRAINING_BUCKET = "deeptrack-sentinel-training";/);
  assert.match(lib, /export const PLAY_LINK_SECONDS = 30 \* 60;/);
  assert.match(lib, /return `training\/\$\{video\}\/\$\{voice\}\.\$\{kind\}`;/);
  // Playback checks the viewer first, and signs a GET for that one object.
  assert.match(node, /const allowed[^=]*= await ctx\.runQuery\(internalApi\.trainingVideos\._canPlay, args\);\s*\n\s*if \(!allowed\) throw/);
  assert.match(node, /getSignedUrl\(\s*client,\s*new GetObjectCommand/);
  assert.match(node, /\{ expiresIn: PLAY_LINK_SECONDS \}/);
  assert.match(node, /ResponseCacheControl: "private, no-store"/);
  // Uploads are internal (CLI only), never callable from the browser.
  assert.match(node, /export const uploadUrls = internalAction\(/);
  assert.match(node, /export const confirmUpload = internalAction\(/);
  assert.doesNotMatch(node + access, /youtube|ACL|public-read/i);
});

test("Back Office videos are for staff only; client videos for members and staff", () => {
  assert.match(access, /return video\.internal \? who\.staff : who\.staff \|\| who\.member;/);
  assert.match(access, /if \(!identity\) return null;/);
  assert.match(access, /row\.isActive/);
  assert.match(access, /client\?\.status === "active"/);
  assert.match(access, /export const _canPlay = internalQuery\(/);
});

test("the player loads nothing until play, hides downloads and refreshes an expired link", () => {
  const player = read("components/help/help-videos.tsx");
  assert.match(player, /controlsList="nodownload noremoteplayback"/);
  assert.match(player, /disablePictureInPicture/);
  assert.match(player, /onClick=\{\(\) => void load\(voice\)\}/);
  assert.match(player, /"Listen with a Kenyan voice"/);
  assert.match(player, /retries\.current >= 2/);
  assert.match(read("components/help/help-article.tsx"), /<HelpVideos chapterId=\{chapter\.id\} \/>/);
});

test("the browser may load media from the bucket and nowhere else new", () => {
  const config = read("next.config.ts");
  assert.match(config, /process\.env\.TRAINING_VIDEOS_BUCKET\?\.trim\(\) \|\| "deeptrack-sentinel-training"\}\.s3\.eu-west-1\.amazonaws\.com/);
  assert.match(config, /`media-src 'self' data: blob: \$\{trainingVideos\}`/);
});

test("publishing uses short-lived upload links, never a public host", () => {
  const publish = read("tools/videos/publish.mjs");
  assert.match(publish, /convexRun\("trainingVideosNode:uploadUrls"/);
  assert.match(publish, /convexRun\("trainingVideosNode:confirmUpload"/);
  assert.doesNotMatch(publish, /AWS_SECRET|AWS_ACCESS|youtube.com|googleapis/i);
});
