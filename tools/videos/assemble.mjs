// Joins the recording with each voice's narration, placed at each scene's
// start, into out/<video>/<video>-<voice>.mp4 (1080p H.264 + AAC) and a
// caption file <video>-<voice>.srt (publish.mjs turns it into WebVTT).
//   node tools/videos/assemble.mjs b11-review-case
import fs from "node:fs";
import path from "node:path";
import { OUT, ffmpeg, loadScript, narratedVoices, secondsToSrt } from "./lib.mjs";

const script = loadScript(process.argv[2] ?? "");
const base = path.join(OUT, script.video);
const timeline = JSON.parse(fs.readFileSync(path.join(base, "timeline.json"), "utf8"));
const recording = path.join(base, "recording.webm");

for (const voice of narratedVoices(script)) {
  const narration = JSON.parse(fs.readFileSync(path.join(base, voice, "narration.json"), "utf8"));
  const inputs = ["-i", recording];
  const filters = [];
  let narrationOffset = 0;
  const cues = [];
  narration.scenes.forEach((scene, index) => {
    const start = timeline.scenes.find((item) => item.id === scene.id)?.start ?? 0;
    inputs.push("-i", path.join(base, voice, `${scene.id}.mp3`));
    const ms = Math.round(start * 1000);
    filters.push(`[${index + 1}:a]adelay=${ms}|${ms}[a${index}]`);
    for (const cue of scene.captions) cues.push({ start: cue.start - narrationOffset + start, end: cue.end - narrationOffset + start, text: cue.text });
    narrationOffset += scene.seconds;
  });
  filters.push(`${narration.scenes.map((_, index) => `[a${index}]`).join("")}amix=inputs=${narration.scenes.length}:normalize=0[aout]`);
  const mp4 = path.join(base, `${script.video}-${voice}.mp4`);
  console.log(`Assembling ${path.basename(mp4)}…`);
  ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-t", String(timeline.total), "-movflags", "+faststart", mp4]);
  const srt = cues.map((cue, index) => `${index + 1}\n${secondsToSrt(cue.start)} --> ${secondsToSrt(cue.end)}\n${cue.text}\n`).join("\n");
  fs.writeFileSync(path.join(base, `${script.video}-${voice}.srt`), srt);
  console.log(`  → ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB) + captions`);
}
