// Uploads finished videos to DeepTrack's private training bucket and lists
// them in Sentinel's Help. Never to YouTube or any public host: the videos
// show Sentinel's screens. Uses short-lived upload links from Convex
// (trainingVideosNode:uploadUrls), so no AWS key is needed here.
//   node tools/videos/publish.mjs b11-review-case v01-dashboard-tour [--voice default]
import fs from "node:fs";
import path from "node:path";
import { OUT, convexRun } from "./lib.mjs";

const args = process.argv.slice(2);
const voiceIndex = args.indexOf("--voice");
const voices = voiceIndex >= 0 ? [args[voiceIndex + 1]] : ["default", "kenyan"];
const names = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--voice");
if (!names.length) throw new Error("Name the videos to publish, e.g. b11-review-case");

// SubRip → WebVTT: a header, and dots instead of commas in the timings.
function srtToVtt(srt) {
  return "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").trim() + "\n";
}

async function put(url, body, contentType) {
  const response = await fetch(url, { method: "PUT", body, headers: { "Content-Type": contentType } });
  if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
}

for (const name of names) {
  for (const voice of voices) {
    const mp4 = path.join(OUT, name, `${name}-${voice}.mp4`);
    if (!fs.existsSync(mp4)) {
      if (voiceIndex >= 0) console.warn(`  ! ${name} (${voice}): no ${path.basename(mp4)}; make it first.`);
      continue;
    }
    const srt = path.join(OUT, name, `${name}-${voice}.srt`);
    const withCaptions = fs.existsSync(srt);
    const links = convexRun("trainingVideosNode:uploadUrls", { video: name, voice, withCaptions });
    const bytes = fs.readFileSync(mp4);
    console.log(`Uploading ${name} (${voice}), ${(bytes.length / 1048576).toFixed(1)} MB…`);
    await put(links.video, bytes, "video/mp4");
    if (withCaptions && links.captions) await put(links.captions, srtToVtt(fs.readFileSync(srt, "utf8")), "text/vtt");
    const done = convexRun("trainingVideosNode:confirmUpload", { video: name, voice });
    console.log(`  ✓ in Help${done.hasCaptions ? ", with captions" : ""}`);
  }
}
